import fetch from 'node-fetch';
import { DbaasProvider, DbaasDatabase, DbaasProjectCreated } from './types';

interface NeonProject {
  id: string;
  name: string;
  region_id: string;
  pg_version: number;
  created_at: string;
}

interface NeonListResponse {
  projects: NeonProject[];
  pagination?: { cursor?: string };
}

interface NeonCreateResponse {
  project: { id: string; name: string };
  connection_uris?: Array<{
    connection_uri: string;
    connection_parameters?: {
      database: string;
      host: string;
      password: string;
      role: string;
    };
  }>;
  endpoints?: Array<{ host: string }>;
  databases?: Array<{ name: string }>;
  roles?: Array<{ name: string }>;
}

export const neonProvider: DbaasProvider = {
  id: 'neon',
  displayName: 'Neon',
  description: 'Serverless Postgres — branching, autoscaling, scale-to-zero',
  engines: ['postgres'],
  supportsCreate: true,
  credentialFields: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      placeholder: '••••••••••••••••••••',
      helpText: 'Create at console.neon.tech → Account Settings → API Keys',
    },
  ],

  async fetchDatabases(credentials): Promise<DbaasDatabase[]> {
    // H5: Neon API is paginated (max 100 per page). Fetch all pages via cursor.
    const allProjects: NeonProject[] = [];
    let cursor: string | undefined;

    do {
      const params = new URLSearchParams({ limit: '100' });
      if (cursor) params.set('cursor', cursor);

      const res = await fetch(`https://console.neon.tech/api/v2/projects?${params}`, {
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          Accept: 'application/json',
        },
        timeout: 10000,
      } as any);

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Neon API error ${res.status}: ${body}`);
      }

      const data = (await res.json()) as NeonListResponse;
      const page = data.projects ?? [];
      allProjects.push(...page);
      // Stop if Neon returns an empty page — cursor can persist even with no more results
      cursor = page.length > 0 ? data.pagination?.cursor : undefined;
    } while (cursor);

    return allProjects.map(p => ({
      id: p.id,
      name: p.name,
      region: p.region_id ?? 'unknown',
      engine: 'postgres',
      pgVersion: p.pg_version ? String(p.pg_version) : undefined,
      consoleUrl: `https://console.neon.tech/app/projects/${p.id}`,
    }));
  },

  async createProject(credentials, name): Promise<DbaasProjectCreated> {
    const res = await fetch('https://console.neon.tech/api/v2/projects', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ project: { name } }),
      timeout: 30000,
    } as any);

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Neon API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as NeonCreateResponse;
    const uri = data.connection_uris?.[0];
    const params = uri?.connection_parameters;

    return {
      id: data.project.id,
      name: data.project.name,
      connectionUri: uri?.connection_uri ?? '',
      host: params?.host ?? data.endpoints?.[0]?.host ?? '',
      database: params?.database ?? data.databases?.[0]?.name ?? 'neondb',
      user: params?.role ?? data.roles?.[0]?.name ?? '',
      password: params?.password ?? '',
    };
  },
};
