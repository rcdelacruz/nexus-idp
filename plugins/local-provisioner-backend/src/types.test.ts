/**
 * Tests for the generic provision-training task type: labId validation, resource-type mapping
 * and the create-task validator. labId becomes a catalog tag, spec.type and a config-map key, so
 * anything that would break the catalog or a map lookup must be rejected up front.
 */

import {
  TaskType,
  isProvisionTask,
  isTrainingTask,
  isValidLabId,
  lookupByResourceType,
  resourceTypeForTask,
  validateTrainingTask,
} from './types';

describe('isValidLabId', () => {
  it.each(['ministack', 'sre-observability', 'a', 'lab2', 'a-b-c', 'x'.repeat(40)])('accepts %s', id => {
    expect(isValidLabId(id)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['double hyphen (invalid catalog tag)', 'a--b'],
    ['leading hyphen', '-lab'],
    ['trailing hyphen', 'lab-'],
    ['uppercase', 'MiniStack'],
    ['path chars', '../etc'],
    ['spaces', 'my lab'],
    ['too long', 'x'.repeat(41)],
    ['reserved legacy type', 'kafka'],
    ['reserved legacy training type', 'kafka-training'],
    ['reserved legacy capstone type', 'devops-capstone-training'],
  ])('rejects %s', (_label, id) => {
    expect(isValidLabId(id)).toBe(false);
  });

  it.each([undefined, null, 42, {}, ['lab']])('rejects non-string %p', v => {
    expect(isValidLabId(v)).toBe(false);
  });
});

describe('resourceTypeForTask', () => {
  it('maps legacy types exactly as before', () => {
    expect(resourceTypeForTask(TaskType.PROVISION_KAFKA)).toBe('kafka');
    expect(resourceTypeForTask(TaskType.PROVISION_KAFKA_TRAINING)).toBe('kafka-training');
    expect(resourceTypeForTask(TaskType.PROVISION_DEVSECOPS_CAPSTONE_TRAINING, { labId: 'x' })).toBe(
      'devsecops-capstone-training',
    );
  });

  it('maps provision-training to its labId', () => {
    expect(resourceTypeForTask(TaskType.PROVISION_TRAINING, { labId: 'ministack' })).toBe('ministack');
  });

  it('gives provision-training no type when labId is missing or invalid', () => {
    expect(resourceTypeForTask(TaskType.PROVISION_TRAINING)).toBeUndefined();
    expect(resourceTypeForTask(TaskType.PROVISION_TRAINING, {})).toBeUndefined();
    expect(resourceTypeForTask(TaskType.PROVISION_TRAINING, { labId: 'a--b' })).toBeUndefined();
    expect(resourceTypeForTask(TaskType.PROVISION_TRAINING, { labId: 'kafka' })).toBeUndefined();
  });

  it('gives lifecycle tasks no type', () => {
    expect(resourceTypeForTask(TaskType.STOP, { labId: 'ministack' })).toBeUndefined();
  });
});

describe('isProvisionTask / isTrainingTask', () => {
  it('treats provision-training as a training provision', () => {
    expect(isProvisionTask(TaskType.PROVISION_TRAINING)).toBe(true);
    expect(isTrainingTask(TaskType.PROVISION_TRAINING)).toBe(true);
  });

  it('keeps legacy classifications', () => {
    expect(isTrainingTask(TaskType.PROVISION_KAFKA_TRAINING)).toBe(true);
    expect(isTrainingTask(TaskType.PROVISION_KAFKA)).toBe(false);
    expect(isTrainingTask(TaskType.STOP)).toBe(false);
  });
});

describe('validateTrainingTask', () => {
  const valid = { task_type: TaskType.PROVISION_TRAINING, config: { labId: 'ministack', dockerCompose: 'services: {}' } };

  it('accepts a well-formed generic lab', () => {
    expect(validateTrainingTask(valid)).toBeUndefined();
  });

  it('ignores every other task type, including legacy training types', () => {
    expect(validateTrainingTask({ task_type: TaskType.PROVISION_KAFKA, config: {} })).toBeUndefined();
    expect(validateTrainingTask({ task_type: TaskType.PROVISION_KAFKA_TRAINING, config: {} })).toBeUndefined();
    expect(validateTrainingTask({ task_type: TaskType.STOP, config: {} })).toBeUndefined();
  });

  it('rejects a non-object config', () => {
    expect(validateTrainingTask({ ...valid, config: 'x' as any })).toMatch(/config must be an object/);
    expect(validateTrainingTask({ ...valid, config: ['x'] as any })).toMatch(/config must be an object/);
  });

  it('rejects a missing, malformed or reserved labId', () => {
    expect(validateTrainingTask({ ...valid, config: { dockerCompose: 'x' } })).toMatch(/labId/);
    expect(validateTrainingTask({ ...valid, config: { labId: 'a--b', dockerCompose: 'x' } })).toMatch(/labId/);
    expect(validateTrainingTask({ ...valid, config: { labId: 'kafka', dockerCompose: 'x' } })).toMatch(/labId/);
  });

  it('rejects a missing or blank dockerCompose (the agent would fall back to Kafka)', () => {
    expect(validateTrainingTask({ ...valid, config: { labId: 'ministack' } })).toMatch(/dockerCompose/);
    expect(validateTrainingTask({ ...valid, config: { labId: 'ministack', dockerCompose: '   ' } })).toMatch(
      /dockerCompose/,
    );
  });
});

describe('lookupByResourceType', () => {
  const map = { ministack: 'docs-ministack' };

  it('returns own keys only', () => {
    expect(lookupByResourceType(map, 'ministack')).toBe('docs-ministack');
    expect(lookupByResourceType(map, 'other')).toBeUndefined();
    expect(lookupByResourceType(map, undefined)).toBeUndefined();
  });

  it('never returns inherited Object.prototype members', () => {
    expect(lookupByResourceType(map, 'constructor')).toBeUndefined();
    expect(lookupByResourceType(map, 'toString')).toBeUndefined();
  });
});
