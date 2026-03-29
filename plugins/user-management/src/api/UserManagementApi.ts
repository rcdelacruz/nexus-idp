import { DiscoveryApi, IdentityApi } from '@backstage/core-plugin-api';

export class UserManagementApi {
  constructor(
    private readonly discoveryApi: DiscoveryApi,
    private readonly identityApi: IdentityApi,
  ) {}

  private async requestRaw(method: string, path: string, body?: object): Promise<Response> {
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

  async getMe(): Promise<{
    name: string; display_name: string; email: string;
    teams: string[]; is_lead: boolean; is_admin: boolean; github_username: string | null;
  } | null> {
    const res = await this.requestRaw('GET', '/me');
    if (!res.ok) return null;
    const data = await res.json() as { user: any };
    return data.user;
  }

  async listUsers(): Promise<Array<{
    name: string; display_name: string; email: string;
    teams: string[]; is_lead: boolean; is_admin: boolean; github_username: string | null;
    onboarding_catalog_tour: boolean; onboarding_engineering_docs: boolean;
  }>> {
    const res = await this.requestRaw('GET', '/users');
    if (!res.ok) {
      const data = await res.json() as { error?: string };
      throw new Error(data.error ?? `Request failed: ${res.status}`);
    }
    const data = await res.json() as { users: any[] };
    return data.users;
  }

  private async request(
    method: string,
    path: string,
    body?: object,
  ): Promise<{ ok: boolean; message?: string; error?: string }> {
    const res = await this.requestRaw(method, path, body);
    const data = await res.json() as { ok?: boolean; message?: string; error?: string };
    if (!res.ok) throw new Error(data.error ?? `Request failed: ${res.status}`);
    return { ok: true, message: data.message };
  }

  register(args: { displayName: string; team: string }) {
    return this.request('POST', '/register', args);
  }

  linkGithub(args: { githubUsername: string; oauthToken?: string }) {
    return this.request('POST', '/link-github', args);
  }

  assign(args: { userName: string; teams: string[]; isLead?: boolean; displayName?: string }) {
    return this.request('POST', '/assign', args);
  }

  promote(args: { userName: string; isAdmin: boolean }) {
    return this.request('POST', '/promote', args);
  }

  deleteUser(userName: string) {
    return this.request('DELETE', `/users/${encodeURIComponent(userName)}`);
  }

  markOnboardingStep(step: 'catalog_tour' | 'engineering_docs', done: boolean) {
    return this.request('POST', '/onboarding-step', { step, done });
  }
}
