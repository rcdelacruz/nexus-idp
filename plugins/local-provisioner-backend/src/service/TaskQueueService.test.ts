import { mockServices } from '@backstage/backend-test-utils';
import { CheckRowProtectedError, TaskQueueService } from './TaskQueueService';
import { TaskStatus, TaskType } from '../types';

/**
 * A check row is the instructor's grade, queued on the trainee's lab so it sits in the trainee's own list. The trainee must not be
 * able to delete it (audit 2026-11-07). The real service runs against a stub store, so a refusal can be told from "nothing happened
 * because the stub is empty": the store's delete must NOT be called.
 */
describe('TaskQueueService.deleteTask', () => {
  const OWNER = 'trainee@example.com';
  const row = (over: Record<string, unknown>) => ({
    task_id: 't1', agent_id: 'a1', user_id: OWNER, resource_name: 'lab-1', task_type: TaskType.PROVISION_TRAINING, status: TaskStatus.COMPLETED, ...over,
  });
  const make = (task: any, resource?: any) => {
    const store = {
      getTaskById: jest.fn(async () => task),
      getResourceState: jest.fn(async () => resource),
      deleteTask: jest.fn(async () => undefined),
    };
    return { store, service: new TaskQueueService(mockServices.logger.mock(), store as any) };
  };

  it.each([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.PENDING, TaskStatus.IN_PROGRESS])(
    'refuses the owner deleting a %s check row and deletes nothing',
    async status => {
      const { store, service } = make(row({ task_type: TaskType.RUN_CHECK, status }));
      await expect(service.deleteTask('t1', OWNER)).rejects.toBeInstanceOf(CheckRowProtectedError);
      expect(store.deleteTask).not.toHaveBeenCalled();
    },
  );

  it('the refusal message does not collide with the route\'s substring matches', async () => {
    const { service } = make(row({ task_type: TaskType.RUN_CHECK }));
    const err = await service.deleteTask('t1', OWNER).catch(e => e);
    expect(err.message).not.toMatch(/not found|does not belong to user|cannot be deleted/);
  });

  it('a non-owner still gets the ownership refusal first (nothing is revealed about what the row is)', async () => {
    const { store, service } = make(row({ task_type: TaskType.RUN_CHECK }));
    await expect(service.deleteTask('t1', 'someone.else@example.com')).rejects.toThrow(/does not belong to user/);
    expect(store.deleteTask).not.toHaveBeenCalled();
  });

  it('still deletes an ordinary finished task of the owner', async () => {
    const { store, service } = make(row({}));
    await service.deleteTask('t1', OWNER);
    expect(store.deleteTask).toHaveBeenCalledWith('t1');
  });

  it('still refuses the task that is a live lab\'s current state', async () => {
    const { store, service } = make(row({}), { state: 'running', latest_task_id: 't1' });
    await expect(service.deleteTask('t1', OWNER)).rejects.toThrow(/cannot be deleted/);
    expect(store.deleteTask).not.toHaveBeenCalled();
  });
});
