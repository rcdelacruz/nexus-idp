import React from 'react';
import { fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderInTestApp } from '@backstage/test-utils';
import { TasksList, resourceKey } from './TasksList';
import { ProvisioningTask, Resource } from '../../api/types';

const stuck: ProvisioningTask = {
  id: 'ffa3a379',
  agentId: 'agent-mac',
  userId: 'ron@example.com',
  taskType: 'provision-training',
  resourceName: 'linux-capstone-ron',
  config: { labId: 'linux-capstone' },
  status: 'in-progress',
  createdAt: new Date(Date.now() - 40 * 60_000).toISOString(),
  updatedAt: new Date().toISOString(),
  startedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
  metadata: { activity: [{ at: new Date(Date.now() - 35 * 60_000).toISOString(), step: 'seeding the server (10–20 min)' }] },
};
const resource: Resource = {
  resourceName: stuck.resourceName,
  agentId: stuck.agentId,
  userId: stuck.userId,
  state: 'provisioning' as any,
  updatedAt: stuck.updatedAt,
  latestTaskId: stuck.id,
};

const render = (onLifecycle = jest.fn()) =>
  renderInTestApp(
    <TasksList
      tasks={[stuck]}
      resources={{ [resourceKey(stuck.agentId, stuck.resourceName)]: resource }}
      loading={false}
      error={null}
      onView={jest.fn()}
      onDelete={jest.fn()}
      onRetry={jest.fn()}
      onDispatch={jest.fn()}
      onLifecycle={onLifecycle}
      selectedTaskIds={new Set()}
      onToggleSelect={jest.fn()}
      onToggleSelectAll={jest.fn()}
    />,
  );

describe('TasksList — a lab stuck in setup', () => {
  it('shows what it is doing and for how long', async () => {
    await render();
    expect(screen.getByText(/Setting up the server · 35 min/)).toBeInTheDocument();
  });

  it('can be cancelled and removed', async () => {
    const onLifecycle = jest.fn();
    await render(onLifecycle);
    fireEvent.click(screen.getByLabelText('actions'));
    fireEvent.click(screen.getByText('Cancel & remove'));
    expect(onLifecycle).toHaveBeenCalledWith(stuck, 'deprovision');
  });
});
