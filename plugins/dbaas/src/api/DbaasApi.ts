import { createApiRef } from '@backstage/core-plugin-api';
import {
  ProviderInfo,
  DbaasConnection,
  DbaasDatabase,
  AddConnectionInput,
} from './types';

export const dbaasApiRef = createApiRef<DbaasApi>({
  id: 'plugin.dbaas.service',
});

export interface DbaasApi {
  getProviders(): Promise<ProviderInfo[]>;
  getConnections(): Promise<DbaasConnection[]>;
  addConnection(input: AddConnectionInput): Promise<DbaasConnection>;
  deleteConnection(id: string): Promise<void>;
  syncConnection(id: string): Promise<void>;
  getDatabases(connectionId: string): Promise<DbaasDatabase[]>;
}
