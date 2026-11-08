import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { alertApiRef } from '@backstage/core-plugin-api';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import { AgentRegistration, ProvisioningTask } from '../../api/types';
import { LocalProvisionerPage } from './LocalProvisionerPage';

jest.setTimeout(30000);

const LAB_ID = '3f2b8c1e-5a7d-4e90-9b1c-0d4e6f8a1b2c';
const OTHER_ID = '9a8b7c6d-1111-4222-8333-444455556666';

const lab: ProvisioningTask = {
  id: LAB_ID,
  agentId: 'agent-mac',
  userId: 'ron@example.com',
  taskType: 'provision-training',
  resourceName: 'linux-capstone-a-ron-20261103-1001',
  config: { labId: 'linux-capstone-a' },
  status: 'pending',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const other: ProvisioningTask = { ...lab, id: OTHER_ID, resourceName: 'kafka-training-ron-20261101-0900', config: { labId: 'kafka-training' }, status: 'completed' };

/** What the page's API returns; tests change `state` while the page is open (it polls every 3 s). */
function build(state: { tasks: ProvisioningTask[] | Error }, agents: AgentRegistration[] = []) {
  const api: any = {
    getTasks: jest.fn(async () => {
      if (state.tasks instanceof Error) throw state.tasks;
      return state.tasks;
    }),
    getResources: async () => [],
    getAgents: async () => agents,
    getAgentStatus: async () => null,
  };
  const alerts: any[] = [];
  const alertApi: any = { post: (a: any) => alerts.push(a), alert$: () => ({ subscribe: () => ({ unsubscribe() {} }) }) };
  return { api, alerts, alertApi };
}

const Where = () => <span data-testid="where">{useLocation().pathname}</span>;
const GoToLab = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(`/local-provisioner/tasks/${LAB_ID}`)}>
      go to the lab
    </button>
  );
};

async function open(path: string, h: ReturnType<typeof build>) {
  await renderInTestApp(
    <TestApiProvider apis={[[localProvisionerApiRef, h.api], [alertApiRef, h.alertApi]]}>
      <Routes>
        <Route path="/local-provisioner/*" element={<LocalProvisionerPage />} />
      </Routes>
      <Where />
      <GoToLab />
    </TestApiProvider>,
    { routeEntries: [path] },
  );
}

/** The drawer's close button is the only element named "close" on the page. */
const drawerClose = () => screen.queryByRole('button', { name: 'close' });
const where = () => screen.getByTestId('where').textContent;

describe('LocalProvisionerPage: a lab named in the URL', () => {
  it('opens that lab\'s drawer once the list has loaded, without a message', async () => {
    const h = build({ tasks: [lab, other] });
    await open(`/local-provisioner/tasks/${LAB_ID}`, h);
    expect(await screen.findByRole('button', { name: 'close' })).toBeInTheDocument();
    expect(screen.getAllByText(lab.resourceName).length).toBeGreaterThan(1); // the row and the drawer header
    expect(h.alerts).toHaveLength(0);
    expect(where()).toBe(`/local-provisioner/tasks/${LAB_ID}`);
  });

  it('opens the right lab when there are several, matching the id in any letter case', async () => {
    const h = build({ tasks: [other, lab] });
    await open(`/local-provisioner/tasks/${LAB_ID.toUpperCase()}`, h);
    await screen.findByRole('button', { name: 'close' });
    // The drawer header is an h6; the table cells are not headings.
    expect(screen.getByRole('heading', { level: 6, name: lab.resourceName })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 6, name: other.resourceName })).not.toBeInTheDocument();
  });

  it('opens the lab even when the agent filter hides its row', async () => {
    const otherAgent: AgentRegistration = {
      id: 'agent-other',
      userId: 'ron@example.com',
      hostname: 'other-laptop.local',
      lastSeenAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      isConnected: true,
      explicitlyDisconnected: false,
    };
    const h = build({ tasks: [lab] }, [otherAgent]);
    await open('/local-provisioner', h);
    await screen.findAllByText(lab.resourceName);
    // Filter to an agent the lab is not on: the table no longer lists it.
    fireEvent.click(await screen.findByText(/other-laptop/));
    await waitFor(() => expect(screen.queryAllByText(lab.resourceName)).toHaveLength(0));
    // Then the Create run sends you to the lab: its drawer opens all the same.
    fireEvent.click(screen.getByRole('button', { name: 'go to the lab' }));
    expect(await screen.findByRole('button', { name: 'close' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 6, name: lab.resourceName })).toBeInTheDocument();
    expect(h.alerts).toHaveLength(0);
  });

  it('closing the drawer leaves the lab URL, so Back or a refresh does not open it again', async () => {
    const h = build({ tasks: [lab] });
    await open(`/local-provisioner/tasks/${LAB_ID}`, h);
    fireEvent.click(await screen.findByRole('button', { name: 'close' }));
    await waitFor(() => expect(drawerClose()).not.toBeInTheDocument());
    expect(where()).toBe('/local-provisioner');
    expect(h.alerts).toHaveLength(0);
  });

  it('keeps the open drawer live as the task changes', async () => {
    const state = { tasks: [lab] as ProvisioningTask[] };
    const h = build(state);
    await open(`/local-provisioner/tasks/${LAB_ID}`, h);
    await screen.findByRole('button', { name: 'close' });
    expect(screen.queryAllByText(/completed/i).length).toBe(0);
    state.tasks = [{ ...lab, status: 'completed', updatedAt: new Date(Date.now() + 5000).toISOString() }];
    await waitFor(() => expect(screen.queryAllByText(/completed/i).length).toBeGreaterThan(0), { timeout: 8000 });
    expect(drawerClose()).toBeInTheDocument();
  });

  it('says that the lab is not in your list, and clears the URL, for an id that is not yours or does not exist', async () => {
    const h = build({ tasks: [other] });
    await open(`/local-provisioner/tasks/${LAB_ID}`, h);
    await waitFor(() => expect(where()).toBe('/local-provisioner'));
    expect(drawerClose()).not.toBeInTheDocument();
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0]).toMatchObject({ severity: 'warning', message: expect.stringContaining('not in your list') });
  });

  it('decides nothing while the list cannot be loaded, and opens the lab once it can', async () => {
    const state = { tasks: new Error('Failed to fetch tasks') as ProvisioningTask[] | Error };
    const h = build(state);
    await open(`/local-provisioner/tasks/${LAB_ID}`, h);
    await waitFor(() => expect(h.api.getTasks).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(where()).toBe(`/local-provisioner/tasks/${LAB_ID}`);
    expect(h.alerts).toHaveLength(0);
    expect(drawerClose()).not.toBeInTheDocument();
    state.tasks = [lab];
    expect(await screen.findByRole('button', { name: 'close' }, { timeout: 8000 })).toBeInTheDocument();
    expect(h.alerts).toHaveLength(0);
  });

  it('closes quietly, without a message, when the lab goes away while you are looking at it', async () => {
    const state = { tasks: [lab] as ProvisioningTask[] };
    const h = build(state);
    await open(`/local-provisioner/tasks/${LAB_ID}`, h);
    await screen.findByRole('button', { name: 'close' });
    state.tasks = [other];
    await waitFor(() => expect(where()).toBe('/local-provisioner'), { timeout: 8000 });
    expect(drawerClose()).not.toBeInTheDocument();
    expect(h.alerts).toHaveLength(0);
  });
});

describe('LocalProvisionerPage: without a lab in the URL', () => {
  it('shows no drawer and no message', async () => {
    const h = build({ tasks: [lab] });
    await open('/local-provisioner', h);
    await screen.findAllByText(lab.resourceName);
    expect(drawerClose()).not.toBeInTheDocument();
    expect(h.alerts).toHaveLength(0);
  });

  it('does not treat the Trainees path or a malformed lab path as a lab', async () => {
    const h = build({ tasks: [lab] });
    await open('/local-provisioner/tasks/not-a-task-id', h);
    await screen.findAllByText(lab.resourceName);
    expect(drawerClose()).not.toBeInTheDocument();
    expect(h.alerts).toHaveLength(0);
    expect(where()).toBe('/local-provisioner/tasks/not-a-task-id');
  });

  it('still opens a drawer from a row and leaves the URL alone', async () => {
    const h = build({ tasks: [lab] });
    await open('/local-provisioner', h);
    fireEvent.click((await screen.findAllByText(lab.resourceName))[0]);
    expect(await screen.findByRole('button', { name: 'close' })).toBeInTheDocument();
    expect(where()).toBe('/local-provisioner');
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    await waitFor(() => expect(drawerClose()).not.toBeInTheDocument());
    expect(where()).toBe('/local-provisioner');
  });
});
