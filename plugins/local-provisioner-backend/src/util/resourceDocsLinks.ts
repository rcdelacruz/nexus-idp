import { Config } from '@backstage/config';

function readStringMap(config: Config, key: string): Record<string, string> {
  const section = config.getOptionalConfig('localProvisioner')?.getOptionalConfig(key);
  if (!section) return {};
  const result: Record<string, string> = {};
  for (const k of section.keys()) {
    result[k] = section.getString(k);
  }
  return result;
}

/**
 * Read `localProvisioner.resourceDocsLinks` (resource type -> catalog entity ref) from config.
 * Used by the catalog module to set `dependsOn` on the provisioned Resource entity, linking it
 * to related documentation (e.g. training materials) in the catalog Relations graph.
 */
export function readResourceDocsLinks(config: Config): Record<string, string> {
  return readStringMap(config, 'resourceDocsLinks');
}

/**
 * Read `localProvisioner.resourceDocsUrls` (resource type -> engineering-docs source id) from
 * config. Used by the task routes to build a direct `/engineering-docs?source=...&path=index`
 * link, rendered in the task detail drawer. Kept separate from `resourceDocsLinks` (a catalog
 * entity ref) since the entity's `engineering-docs/source-id` annotation is not always the same
 * as its catalog entity name (see example-org/components/*.yaml), and resolving it from the ref
 * would require an authenticated backend->catalog call this plugin doesn't otherwise make.
 */
export function readResourceDocsUrls(config: Config): Record<string, string> {
  const sourceIds = readStringMap(config, 'resourceDocsUrls');
  const result: Record<string, string> = {};
  for (const [resourceType, sourceId] of Object.entries(sourceIds)) {
    result[resourceType] = `/engineering-docs?source=${encodeURIComponent(sourceId)}&path=index`;
  }
  return result;
}
