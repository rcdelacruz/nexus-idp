/**
 * toEntity for generic training labs: the labId becomes a tag and spec.type, so the generated
 * entity must pass Backstage's own tag validation, and config-map lookups must ignore
 * Object.prototype members.
 */

import { CommonValidatorFunctions } from '@backstage/catalog-model';
import { toEntity } from './LocalProvisionerEntityProvider';
import { Resource, ResourceState } from '../types';

const resource = (partial: Partial<Resource>): Resource => ({
  resource_name: 'ministack-jane-1',
  agent_id: 'agent-1234567890',
  user_id: 'jane.doe@example.com',
  state: ResourceState.RUNNING,
  updated_at: new Date(2026, 0, 1),
  latest_task_id: 't1',
  ...partial,
});

describe('toEntity — generic training lab', () => {
  it('uses the labId as spec.type and adds the training tags, all valid catalog tags', () => {
    const e = toEntity(resource({ resource_type: 'sre-observability', is_training: true }), {});
    expect(e.spec?.type).toBe('sre-observability');
    const tags = e.metadata.tags ?? [];
    expect(tags).toEqual(expect.arrayContaining(['sre-observability', 'training', 'local-provisioning']));
    for (const tag of tags) {
      // the catalog's own tag rule (FieldFormatEntityPolicy → CommonValidatorFunctions.isValidTag)
      expect({ tag, valid: CommonValidatorFunctions.isValidTag(tag) }).toEqual({ tag, valid: true });
    }
  });

  it('does not duplicate tags when the labId equals a built-in tag', () => {
    const tags = toEntity(resource({ resource_type: 'training', is_training: true }), {}).metadata.tags ?? [];
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('links docs by labId, and never via inherited Object.prototype keys', () => {
    const links = { ministack: 'component:default/ministack-training-docs' };
    expect(toEntity(resource({ resource_type: 'ministack', is_training: true }), links).spec?.dependsOn).toEqual([
      'component:default/ministack-training-docs',
    ]);
    expect(toEntity(resource({ resource_type: 'constructor', is_training: true }), links).spec?.dependsOn).toBeUndefined();
  });

  it('keeps legacy behavior: kafka-training gets training tags via its suffix, plain kafka does not', () => {
    expect(toEntity(resource({ resource_type: 'kafka-training' }), {}).metadata.tags).toEqual(
      expect.arrayContaining(['training']),
    );
    expect(toEntity(resource({ resource_type: 'kafka' }), {}).metadata.tags).not.toContain('training');
  });
});
