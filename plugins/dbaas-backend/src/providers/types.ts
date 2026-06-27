export interface CredentialField {
  key: string;
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
  helpText?: string;
}

export interface DbaasDatabase {
  id: string;
  name: string;
  region: string;
  engine: string;      // e.g. 'postgres', 'redis', 'mysql'
  pgVersion?: string;
  consoleUrl?: string;
}

export interface DbaasProviderInfo {
  id: string;
  displayName: string;
  description: string;
  engines: string[];
  credentialFields: CredentialField[];
  /** True if the provider supports on-demand project creation (dbaas:create-project action) */
  supportsCreate: boolean;
}

export interface DbaasProjectCreated {
  id: string;
  name: string;
  connectionUri: string;
  host: string;
  database: string;
  user: string;
  password: string;
}

export interface DbaasProvider extends DbaasProviderInfo {
  fetchDatabases(credentials: Record<string, string>): Promise<DbaasDatabase[]>;
  /** Optional — only providers that support on-demand project creation implement this */
  createProject?(credentials: Record<string, string>, name: string): Promise<DbaasProjectCreated>;
}
