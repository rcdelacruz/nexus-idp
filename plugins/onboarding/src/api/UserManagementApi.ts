import { DiscoveryApi, IdentityApi } from '@backstage/core-plugin-api';

export class UserManagementApi {
  constructor(
    private readonly discoveryApi: DiscoveryApi,
    private readonly identityApi: IdentityApi,
  ) {}

  private async request(method: string, path: string, body?: object): Promise<Response> {
    const baseUrl = await this.discoveryApi.getBaseUrl('user-management');
    const { token } = await this.identityApi.getCredentials();
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  private async post<T = { ok: boolean; message?: string }>(path: string, body: object): Promise<T> {
    const res = await this.request('POST', path, body);
    const data = await res.json() as { ok?: boolean; message?: string; error?: { message?: string } | string } & Record<string, unknown>;
    if (!res.ok) {
      const errMsg =
        typeof data.error === 'object' ? (data.error as any)?.message :
        typeof data.error === 'string' ? data.error :
        `Request failed: ${res.status}`;
      throw new Error(errMsg ?? `Request failed: ${res.status}`);
    }
    return data as T;
  }

  async getMe(): Promise<{
    name: string; display_name: string; email: string;
    teams: string[]; is_lead: boolean; is_admin: boolean; github_username: string | null;
    onboarding_catalog_tour: boolean; onboarding_engineering_docs: boolean;
  } | null> {
    const res = await this.request('GET', '/me');
    if (res.status === 404) return null;          // user not in DB — definitive "not found"
    if (!res.ok) throw new Error(`getMe failed: ${res.status}`);  // server/network error
    const data = await res.json() as { user: any };
    return data.user;
  }

  register(args: { displayName: string; team: string }) {
    return this.post('/register', args);
  }

  linkGithub(args: { githubUsername: string; oauthToken?: string }) {
    return this.post('/link-github', args);
  }

  autoLinkGithub(): Promise<{ found: boolean; username?: string }> {
    return this.post<{ found: boolean; username?: string }>('/auto-link-github', {});
  }

  assign(args: { userName: string; teams: string[]; isLead?: boolean; displayName?: string }) {
    return this.post('/assign', args);
  }

  markOnboardingStep(step: 'catalog_tour' | 'engineering_docs', done: boolean) {
    return this.post('/onboarding-step', { step, done });
  }
}
