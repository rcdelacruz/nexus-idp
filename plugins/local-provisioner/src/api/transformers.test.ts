import { taskTypeLabel } from './transformers';

describe('taskTypeLabel', () => {
  it('shows a generic training lab by its labId', () => {
    expect(taskTypeLabel({ taskType: 'provision-training', config: { labId: 'ministack' } })).toBe('training: ministack');
  });

  it('falls back to the raw type when the labId is missing', () => {
    expect(taskTypeLabel({ taskType: 'provision-training', config: {} })).toBe('provision-training');
  });

  it('leaves every other type unchanged', () => {
    expect(taskTypeLabel({ taskType: 'provision-kafka-training', config: { labId: 'x' } })).toBe('provision-kafka-training');
    expect(taskTypeLabel({ taskType: 'stop', config: {} })).toBe('stop');
  });
});
