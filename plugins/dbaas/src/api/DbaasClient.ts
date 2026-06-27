import { FetchApi, DiscoveryApi } from '@backstage/core-plugin-api';
import { DbaasApi } from './DbaasApi';
import {
  ProviderInfo,
  DbaasConnection,
  DbaasDatabase,
  AddConnectionInput,
} from './types';

export class DbaasClient implements DbaasApi {
  constructor(
    private readonly discoveryApi: DiscoveryApi,
    private readonly fetchApi: FetchApi,
  ) {}

  private async baseUrl(): Promise<string> {
    return this.discoveryApi.getBaseUrl('dbaas');
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${await this.baseUrl()}${path}`;
    const res = await this.fetchApi.fetch(url, init);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      // Backstage errors: { error: { name, message } }  — extract the inner message string
      const errObj = (body as any)?.error;
      const message = typeof errObj === 'string'
        ? errObj
        : typeof errObj?.message === 'string'
          ? errObj.message
          : res.statusText || `API error ${res.status}`;
      throw new Error(message);
    }
    return res.json();
  }

  async getProviders(): Promise<ProviderInfo[]> {
    const data = await this.fetch<{ providers: ProviderInfo[] }>('/providers');
    return data.providers;
  }

  async getConnections(): Promise<DbaasConnection[]> {
    const data = await this.fetch<{ connections: DbaasConnection[] }>('/connections');
    return data.connections;
  }

  async addConnection(input: AddConnectionInput): Promise<DbaasConnection> {
    const data = await this.fetch<{ connection: DbaasConnection }>('/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return data.connection;
  }

  async deleteConnection(id: string): Promise<void> {
    await this.fetch(`/connections/${id}`, { method: 'DELETE' });
  }

  async syncConnection(id: string): Promise<void> {
    await this.fetch(`/connections/${id}/sync`, { method: 'POST' });
  }

  async getDatabases(connectionId: string): Promise<DbaasDatabase[]> {
    const data = await this.fetch<{ databases: DbaasDatabase[] }>(`/connections/${connectionId}/databases`);
    return data.databases;
  }
}
