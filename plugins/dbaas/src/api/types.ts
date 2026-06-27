export interface ProviderInfo {
  id: string;
  displayName: string;
  description: string;
  engines: string[];
  credentialFields: CredentialField[];
  supportsCreate: boolean;
}

export interface CredentialField {
  key: string;
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
  helpText?: string;
}

export interface DbaasConnection {
  id: string;
  provider: string;
  label: string;
  visibility: 'personal' | 'team';
  ownerRef: string;
  lastSynced: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface DbaasDatabase {
  id: string;
  name: string;
  region: string;
  engine: string;
  pgVersion?: string;
  consoleUrl?: string;
}

export interface AddConnectionInput {
  provider: string;
  label: string;
  credentials: Record<string, string>;
  visibility: 'personal' | 'team';
  teamRef?: string;
}
