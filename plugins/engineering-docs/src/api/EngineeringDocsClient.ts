import { createApiRef, DiscoveryApi, IdentityApi } from '@backstage/core-plugin-api';
import { NavItem, DocContent, DocSource, EngineeringDocsApi } from './types';

export const engineeringDocsApiRef = createApiRef<EngineeringDocsApi>({
  id: 'plugin.engineering-docs.service',
});

export class EngineeringDocsClient implements EngineeringDocsApi {
  constructor(
    private readonly discoveryApi: DiscoveryApi,
    private readonly identityApi: IdentityApi,
  ) {}

  private async getBaseUrl(): Promise<string> {
    return this.discoveryApi.getBaseUrl('engineering-docs');
  }

  private async authHeaders(): Promise<HeadersInit> {
    const { token } = await this.identityApi.getCredentials();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }

  private async fetch<T>(path: string): Promise<T> {
    const [baseUrl, headers] = await Promise.all([this.getBaseUrl(), this.authHeaders()]);
    const res = await fetch(`${baseUrl}${path}`, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as any).error ?? res.statusText);
    }
    return res.json();
  }

  private async fetchPost<T>(path: string): Promise<T> {
    const [baseUrl, headers] = await Promise.all([this.getBaseUrl(), this.authHeaders()]);
    const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error((err as any).error ?? res.statusText);
    }
    return res.json();
  }

  async getSources(): Promise<DocSource[]> {
    const data = await this.fetch<{ sources: DocSource[] }>('/docs/sources');
    return data.sources;
  }

  async getNav(sourceId?: string): Promise<NavItem[]> {
    const path = sourceId ? `/docs/sources/${encodeURIComponent(sourceId)}/nav` : '/docs/nav';
    const data = await this.fetch<{ nav: NavItem[] }>(path);
    return data.nav;
  }

  async getContent(docPath: string, sourceId?: string): Promise<DocContent> {
    const base = sourceId ? `/docs/sources/${encodeURIComponent(sourceId)}` : '/docs';
    return this.fetch<DocContent>(`${base}/content?path=${encodeURIComponent(docPath)}`);
  }

  async getEntityNav(repo: string, branch: string, contentBase: string): Promise<NavItem[]> {
    const params = new URLSearchParams({ repo, branch, base: contentBase });
    const data = await this.fetch<{ nav: NavItem[] }>(`/docs/entity/nav?${params}`);
    return data.nav;
  }

  async getEntityContent(
    repo: string,
    branch: string,
    contentBase: string,
    docPath: string,
  ): Promise<DocContent> {
    const params = new URLSearchParams({ repo, branch, base: contentBase, path: docPath });
    return this.fetch<DocContent>(`/docs/entity/content?${params}`);
  }

  async refreshDoc(docPath: string, sourceId?: string): Promise<DocContent> {
    const base = sourceId ? `/docs/sources/${encodeURIComponent(sourceId)}` : '/docs';
    return this.fetchPost<DocContent>(`${base}/refresh/doc?path=${encodeURIComponent(docPath)}`);
  }

  async refreshNav(sourceId?: string): Promise<NavItem[]> {
    const base = sourceId ? `/docs/sources/${encodeURIComponent(sourceId)}` : '/docs';
    const data = await this.fetchPost<{ nav: NavItem[] }>(`${base}/refresh/nav`);
    return data.nav;
  }
}
