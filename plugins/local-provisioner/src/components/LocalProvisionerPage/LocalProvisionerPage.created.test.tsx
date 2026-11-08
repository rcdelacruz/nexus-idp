import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { alertApiRef } from '@backstage/core-plugin-api';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import { justCreatedState } from '../../api/labArrival';
import { ProvisioningTask } from '../../api/types';
import { LocalProvisionerPage } from './LocalProvisionerPage';

jest.setTimeout(30000);

const LAB_ID = '3f2b8c1e-5a7d-4e90-9b1c-0d4e6f8a1b2c';
const LAB_PATH = `/local-provisioner/tasks/${LAB_ID}`;
const REPO = 'https://github.com/example-org/terraform-capstone-a-ron-20261103-1001';
const INVITE = `${REPO}/invitations`;

const lab = (config: Record<string, unknown>, extra: Partial<ProvisioningTask> = {}): ProvisioningTask => ({
  id: LAB_ID,
  agentId: 'agent-mac',
  userId: 'ron@example.com',
  taskType: 'provision-training',
  resourceName: 'terraform-capstone-a-ron-20261103-1001',
  config: { labId: 'terraform-capstone-a', ...config },
  status: 'pending',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...extra,
});

function build(state: { tasks: ProvisioningTask[] }) {
  const api: any = {
    getTasks: jest.fn(async () => state.tasks),
    getResources: async () => [],
    getAgents: async () => [],
    getAgentStatus: async () => null,
  };
  const alerts: any[] = [];
  const alertApi: any = { post: (a: any) => alerts.push(a), alert$: () => ({ subscribe: () => ({ unsubscribe() {} }) }) };
  return { api, alerts, alertApi };
}

const Where = () => {
  const { pathname, state } = useLocation();
  return (
    <>
      <span data-testid="where">{pathname}</span>
      <span data-testid="state">{JSON.stringify(state)}</span>
    </>
  );
};

/** The redirect carries no state at all (a link, a reload). `undefined` would pick the default below. */
const NO_MARK = Symbol('no mark');

/** Arrives the way the Create run page sends you (or not): a redirect with or without the mark. */
async function arrive(h: ReturnType<typeof build>, mark: unknown = justCreatedState(), to = LAB_PATH) {
  const state = mark === NO_MARK ? undefined : mark;
  await renderInTestApp(
    <TestApiProvider apis={[[localProvisionerApiRef, h.api], [alertApiRef, h.alertApi]]}>
      <Routes>
        <Route path="/start" element={<Navigate to={to} state={state} replace />} />
        <Route path="/local-provisioner/*" element={<LocalProvisionerPage />} />
      </Routes>
      <Where />
    </TestApiProvider>,
    { routeEntries: ['/start'] },
  );
}

const toast = () => screen.queryByRole('alert');
const accept = () => screen.queryByText('Accept the invitation');

describe('LocalProvisionerPage: a lab you just created', () => {
  it('shows a toast with the link to accept the GitHub invitation to the lab\'s repo', async () => {
    const h = build({ tasks: [lab({ githubRepoUrl: REPO })] });
    await arrive(h);
    expect(await screen.findByText(/Accept the GitHub invitation to your repo/)).toBeInTheDocument();
    const link = accept()!.closest('a')!;
    expect(link).toHaveAttribute('href', INVITE);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // The lab's drawer is open under it.
    expect(screen.getByRole('button', { name: 'close' })).toBeInTheDocument();
    // One toast: no plain alert on top of it.
    expect(h.alerts).toHaveLength(0);
  });

  it('removes the arrival mark, so a reload or Back never shows the toast again', async () => {
    const h = build({ tasks: [lab({ githubRepoUrl: REPO })] });
    await arrive(h);
    await screen.findByText(/Accept the GitHub invitation to your repo/);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('null'));
    expect(screen.getByTestId('where')).toHaveTextContent(LAB_PATH);
  });

  it('tells a Node.js lab that it waits 30 minutes, and any other lab nothing about waiting', async () => {
    const node = build({ tasks: [lab({ githubRepoUrl: REPO, workspaceMount: true })] });
    await arrive(node);
    expect(await screen.findByText(/This lab waits 30 minutes for it, then fails\./)).toBeInTheDocument();
  });

  it('does not mention waiting for a lab that starts without the repo', async () => {
    const h = build({ tasks: [lab({ githubRepoUrl: REPO })] });
    await arrive(h);
    await screen.findByText(/Accept the GitHub invitation to your repo/);
    expect(screen.queryByText(/waits 30 minutes/)).not.toBeInTheDocument();
  });

  it('is dismissed with the close button', async () => {
    const h = build({ tasks: [lab({ githubRepoUrl: REPO })] });
    await arrive(h);
    fireEvent.click(await screen.findByRole('button', { name: 'dismiss' }));
    await waitFor(() => expect(toast()).not.toBeInTheDocument());
  });

  it('is dismissed once you click the link (you are on your way to accept it)', async () => {
    const h = build({ tasks: [lab({ githubRepoUrl: REPO })] });
    await arrive(h);
    await screen.findByText(/Accept the GitHub invitation to your repo/);
    fireEvent.click(accept()!);
    await waitFor(() => expect(toast()).not.toBeInTheDocument());
  });

  it('goes away by itself once the lab has your code', async () => {
    const state = { tasks: [lab({ githubRepoUrl: REPO })] };
    const h = build(state);
    await arrive(h);
    await screen.findByText(/Accept the GitHub invitation to your repo/);
    expect(toast()).toBeInTheDocument();
    state.tasks = [lab({ githubRepoUrl: REPO }, { updatedAt: new Date(Date.now() + 5000).toISOString(), metadata: { workspace: { status: 'existing', path: '/Users/ron/stratpoint/repo' } } })];
    await waitFor(() => expect(toast()).not.toBeInTheDocument(), { timeout: 8000 });
  });

  it('goes away if the lab is removed while it is showing', async () => {
    const state = { tasks: [lab({ githubRepoUrl: REPO })] };
    const h = build(state);
    await arrive(h);
    await screen.findByText(/Accept the GitHub invitation to your repo/);
    expect(toast()).toBeInTheDocument();
    state.tasks = [];
    await waitFor(() => expect(toast()).not.toBeInTheDocument(), { timeout: 8000 });
    expect(h.alerts).toHaveLength(0);
  });

  it('stays up when you close the drawer: it is a reminder, not part of the drawer', async () => {
    const h = build({ tasks: [lab({ githubRepoUrl: REPO })] });
    await arrive(h);
    await screen.findByText(/Accept the GitHub invitation to your repo/);
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'close' })).not.toBeInTheDocument());
    expect(screen.getByText(/Accept the GitHub invitation to your repo/)).toBeInTheDocument();
    expect(accept()).toBeInTheDocument();
  });

  it('sits at the bottom of the page, so it never covers the portal\'s own toasts (top centre)', async () => {
    const h = build({ tasks: [lab({ githubRepoUrl: REPO })] });
    await arrive(h);
    await screen.findByText(/Accept the GitHub invitation to your repo/);
    // Material UI adds a counter to its class names, hence the attribute selectors.
    expect(document.querySelector('[class*="MuiSnackbar-anchorOriginBottomCenter"]')).not.toBeNull();
    expect(document.querySelector('[class*="MuiSnackbar-anchorOriginTopCenter"]')).toBeNull();
  });

  it('goes away once a Node.js lab is past the wait for its repo (the invitation is accepted; the agent reports the clone only at the end)', async () => {
    const nodeLab = (steps: string[]) =>
      lab({ githubRepoUrl: REPO, workspaceMount: true }, { status: 'in-progress', updatedAt: new Date(Date.now() + steps.length * 1000).toISOString(), metadata: { activity: steps.map((step, i) => ({ at: `2026-11-03T04:4${i}:00Z`, step })) } });
    const state = { tasks: [nodeLab(['Getting your repo', 'Waiting for access to your repo'])] };
    const h = build(state);
    await arrive(h);
    expect(await screen.findByText(/This lab waits 30 minutes for it/)).toBeInTheDocument();
    expect(toast()).toBeInTheDocument();
    state.tasks = [nodeLab(['Getting your repo', 'Waiting for access to your repo', 'images-cached', 'Starting the containers'])];
    await waitFor(() => expect(toast()).not.toBeInTheDocument(), { timeout: 8000 });
  });

  it('goes away if the lab fails', async () => {
    const state = { tasks: [lab({ githubRepoUrl: REPO })] };
    const h = build(state);
    await arrive(h);
    await screen.findByText(/Accept the GitHub invitation to your repo/);
    expect(toast()).toBeInTheDocument();
    state.tasks = [lab({ githubRepoUrl: REPO }, { status: 'failed', errorMessage: 'Copying the lab files into the VM failed', updatedAt: new Date(Date.now() + 5000).toISOString() })];
    await waitFor(() => expect(toast()).not.toBeInTheDocument(), { timeout: 8000 });
  });

  describe('when the lab is removed (its provision task stays in the list; the teardown is a deprovision task)', () => {
    const teardown = (over: Partial<ProvisioningTask>): ProvisioningTask =>
      lab({ targetTaskId: LAB_ID }, { id: 'rm-1', taskType: 'deprovision', status: 'completed', createdAt: new Date(Date.now() + 60_000).toISOString(), updatedAt: new Date(Date.now() + 61_000).toISOString(), ...over });

    it('goes away once the teardown has completed', async () => {
      const state = { tasks: [lab({ githubRepoUrl: REPO })] };
      const h = build(state);
      await arrive(h);
      await screen.findByText(/Accept the GitHub invitation to your repo/);
      expect(toast()).toBeInTheDocument();
      state.tasks = [lab({ githubRepoUrl: REPO }), teardown({})];
      await waitFor(() => expect(toast()).not.toBeInTheDocument(), { timeout: 8000 });
    });

    it('stays while the teardown is still running, or when it belongs to an earlier lab of the same name', async () => {
      const state = { tasks: [lab({ githubRepoUrl: REPO })] };
      const h = build(state);
      await arrive(h);
      await screen.findByText(/Accept the GitHub invitation to your repo/);
      const calls = h.api.getTasks.mock.calls.length;
      state.tasks = [
        lab({ githubRepoUrl: REPO }),
        teardown({ id: 'rm-pending', status: 'in-progress' }),
        teardown({ id: 'rm-old', createdAt: new Date(Date.now() - 3600_000).toISOString(), updatedAt: new Date(Date.now() - 3500_000).toISOString() }),
        teardown({ id: 'rm-other-lab', resourceName: 'some-other-lab' }),
      ];
      await waitFor(() => expect(h.api.getTasks.mock.calls.length).toBeGreaterThan(calls + 1), { timeout: 10000 });
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(toast()).toBeInTheDocument();
    });
  });

  it('only a literal workspaceMount: true makes it say the lab waits', async () => {
    const h = build({ tasks: [lab({ githubRepoUrl: REPO, workspaceMount: 'true' })] });
    await arrive(h);
    await screen.findByText(/Accept the GitHub invitation to your repo/);
    expect(screen.queryByText(/waits 30 minutes/)).not.toBeInTheDocument();
  });

  it('gives a lab with no GitHub repo (Local Database, a GitLab lab) a short note instead, with no link', async () => {
    const h = build({ tasks: [lab({ labId: 'local-database' })] });
    await arrive(h);
    await waitFor(() => expect(h.alerts).toHaveLength(1));
    expect(h.alerts[0]).toMatchObject({ severity: 'success', message: 'Your lab is queued on your laptop.' });
    expect(accept()).not.toBeInTheDocument();

    const gl = build({ tasks: [lab({ gitlabRepoUrl: 'https://gitlab.example.com/example/trainees/devops-capstone-x' })] });
    await arrive(gl);
    await waitFor(() => expect(gl.alerts).toHaveLength(1));
    expect(gl.alerts[0].message).toBe('Your lab is queued on your laptop.');
  });

  it('shows nothing for a repo URL that is not a plain GitHub repo', async () => {
    const h = build({ tasks: [lab({ githubRepoUrl: 'https://github.com.evil.example/o/r' })] });
    await arrive(h);
    await waitFor(() => expect(h.alerts).toHaveLength(1));
    expect(accept()).not.toBeInTheDocument();
  });
});

describe('LocalProvisionerPage: a lab you did not just create', () => {
  it.each([
    ['opened by its URL (a link, a reload, Back)', NO_MARK],
    ['carrying another mark', { labRedirectAt: Date.now() }],
  ])('shows no toast and no note when %s', async (_name, mark) => {
    const h = build({ tasks: [lab({ githubRepoUrl: REPO })] });
    await arrive(h, mark as unknown);
    await screen.findByRole('button', { name: 'close' });
    expect(toast()).not.toBeInTheDocument();
    expect(accept()).not.toBeInTheDocument();
    expect(h.alerts).toHaveLength(0);
  });

  it('still gives the opened lab\'s detail view its own Accept the GitHub invitation button (this is your lab)', async () => {
    const h = build({ tasks: [lab({ githubRepoUrl: REPO })] });
    await arrive(h, NO_MARK);
    await screen.findByRole('button', { name: 'close' });
    expect(screen.getByText('Accept the GitHub invitation').closest('a')).toHaveAttribute('href', INVITE);
  });

  it('shows no toast on the plain list, even with the mark left over', async () => {
    const h = build({ tasks: [lab({ githubRepoUrl: REPO })] });
    await arrive(h, justCreatedState(), '/local-provisioner');
    await screen.findAllByText(lab({}).resourceName);
    expect(toast()).not.toBeInTheDocument();
    expect(h.alerts).toHaveLength(0);
  });

  it('shows no toast for a lab that is not in your list (the not-found message instead)', async () => {
    const h = build({ tasks: [] });
    await arrive(h);
    await waitFor(() => expect(h.alerts).toHaveLength(1));
    expect(h.alerts[0]).toMatchObject({ severity: 'warning' });
    expect(accept()).not.toBeInTheDocument();
  });
});
