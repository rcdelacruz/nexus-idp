import { DbaasProvider, DbaasProviderInfo } from './types';
import { neonProvider } from './neon';

const providers = new Map<string, DbaasProvider>([
  ['neon', neonProvider],
]);

export function getProvider(id: string): DbaasProvider | undefined {
  return providers.get(id);
}

export function getAllProviderInfo(): DbaasProviderInfo[] {
  return Array.from(providers.values()).map(({ id, displayName, description, engines, credentialFields, supportsCreate }) => ({
    id,
    displayName,
    description,
    engines,
    credentialFields,
    supportsCreate: supportsCreate ?? false,
  }));
}
