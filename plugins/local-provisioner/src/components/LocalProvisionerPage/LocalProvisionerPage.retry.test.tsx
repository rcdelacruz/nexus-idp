import React from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { alertApiRef } from '@backstage/core-plugin-api';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import { LabConflict, ProvisioningTask, RetryLeftover } from '../../api/types';
import { LocalProvisionerPage } from './LocalProvisionerPage';

jest.setTimeout(30000);

const failed: ProvisioningTask = {
  id: 'failed-1',
  agentId: 'agent-mac',
  userId: 'ron@example.com',
  taskType: 'provision-training',
  resourceName: 'terraform-capstone-a-ron-20261103-0739',
  config: { labId: 'terraform-capstone-a' },
  status: 'failed',
  errorMessage: 'Port 4566 (a lab service) is already in use on this machine',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const oldLab: LabConflict = {
  resourceName: 'terraform-capstone-ron-20261031-0005',
  state: 'running',
  ports: [4566],
  provisionTaskId: 'prov-old',
};

function build(opts: { conflicts?: LabConflict[] | Error; leftover?: RetryLeftover; failRemoval?: boolean; hold?: 'removal' | 'plan' } = {}) {
  const calls: string[] = [];
  // A phase the test holds open on purpose (never a timer: a loaded machine made a 400 ms window too short for the second click).
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const api: any = {
    getTasks: async () => [failed],
    getResources: async () => [],
    getAgents: async () => [],
    getAgentStatus: async () => null,
    getRetryConflicts: async (id: string) => {
      calls.push(`conflicts ${id}`);
      if (opts.conflicts instanceof Error) throw opts.conflicts;
      return opts.conflicts ?? [];
    },
    getRetryPlan: async (id: string) => {
      calls.push(`conflicts ${id}`);
      if (opts.hold === 'plan') await gate;
      if (opts.conflicts instanceof Error) throw opts.conflicts;
      return { conflicts: opts.conflicts ?? [], leftover: opts.leftover ?? null };
    },
    removeLab: async (agentId: string, c: { resourceName: string; provisionTaskId: string }) => {
      calls.push(`remove ${c.resourceName} -> ${c.provisionTaskId} on ${agentId}`);
      return { ...failed, id: 'rm-1', status: 'pending' };
    },
    waitForTask: async (id: string) => {
      calls.push(`wait ${id}`);
      await new Promise(resolve => setTimeout(resolve, 5)); // the teardown takes a moment
      if (opts.hold === 'removal') await gate;
      if (opts.failRemoval) throw new Error('docker compose down exited with code 1');
      calls.push(`done ${id}`);
      return { ...failed, id, status: 'completed' };
    },
    retryTask: async (t: ProvisioningTask) => {
      calls.push(`retry ${t.id}`);
      return { ...failed, id: 'new-1', status: 'pending' };
    },
  };
  const alerts: any[] = [];
  const alertApi: any = { post: (a: any) => alerts.push(a), alert$: () => ({ subscribe: () => ({ unsubscribe() {} }) }) };
  return { api, calls, alerts, alertApi, release: () => release() };
}

async function renderPage(h: ReturnType<typeof build>) {
  await renderInTestApp(
    <TestApiProvider apis={[[localProvisionerApiRef, h.api], [alertApiRef, h.alertApi]]}>
      <LocalProvisionerPage />
    </TestApiProvider>,
  );
}

async function clickRetry() {
  const row = (await screen.findAllByText(failed.resourceName))[0].closest('tr') as HTMLElement;
  // The row's action button opens the menu that holds Retry.
  const buttons = within(row).getAllByRole('button');
  fireEvent.click(buttons[buttons.length - 1]);
  const retry = await screen.findByText('Retry');
  // The click starts async work (the conflict check) that updates the page when it settles.
  await act(async () => {
    fireEvent.click(retry);
  });
}

async function openRetry(h: ReturnType<typeof build>) {
  await renderPage(h);
  await clickRetry();
}

const press = (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el);
  });

describe('Local Provisioner — Retry when another lab holds the port', () => {
  it('asks first, names the lab and the port, and changes nothing before the answer', async () => {
    const h = build({ conflicts: [oldLab] });
    await openRetry(h);
    expect(await screen.findByText('Remove "terraform-capstone-ron-20261031-0005" and retry?')).toBeInTheDocument();
    expect(screen.getByText(/"terraform-capstone-ron-20261031-0005" \(port 4566\)/)).toBeInTheDocument();
    expect(h.calls).toEqual(['conflicts failed-1']);
    // Data loss must be acknowledged before the button works.
    expect(screen.getByRole('button', { name: 'Remove and retry' })).toBeDisabled();
  });

  it('after the acknowledgement removes the old lab, waits for it, then retries', async () => {
    const h = build({ conflicts: [oldLab] });
    await openRetry(h);
    await press(await screen.findByRole('checkbox'));
    await press(screen.getByRole('button', { name: 'Remove and retry' }));
    await waitFor(() => expect(h.calls).toContain('retry failed-1'));
    expect(h.calls).toEqual([
      'conflicts failed-1',
      'conflicts failed-1', // asked again after the confirmation, before anything is removed
      'remove terraform-capstone-ron-20261031-0005 -> prov-old on agent-mac',
      'wait rm-1',
      'done rm-1',
      'retry failed-1',
    ]);
    expect(h.alerts.some(a => a.message === 'Retrying task')).toBe(true);
  });

  it('Cancel retries nothing and removes nothing', async () => {
    const h = build({ conflicts: [oldLab] });
    await openRetry(h);
    await press(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText(/and retry\?/)).not.toBeInTheDocument());
    expect(h.calls).toEqual(['conflicts failed-1']);
  });

  it('does not retry, and says which lab, when the removal fails', async () => {
    const h = build({ conflicts: [oldLab], failRemoval: true });
    await openRetry(h);
    await press(await screen.findByRole('checkbox'));
    await press(screen.getByRole('button', { name: 'Remove and retry' }));
    await waitFor(() => expect(h.alerts.length).toBeGreaterThan(0));
    expect(h.alerts[0].message).toBe(
      'Could not remove "terraform-capstone-ron-20261031-0005": docker compose down exited with code 1. It may still be using the port: stop it in Docker Desktop, then press Retry again.',
    );
    expect(h.calls).not.toContain('retry failed-1');
  });

  it('retries straight away, with no dialog, when nothing is in the way', async () => {
    const h = build({ conflicts: [] });
    await openRetry(h);
    await waitFor(() => expect(h.calls).toEqual(['conflicts failed-1', 'retry failed-1']));
    expect(screen.queryByText(/and retry\?/)).not.toBeInTheDocument();
  });

  it('retries as before when the conflict check itself cannot be made', async () => {
    const h = build({ conflicts: new Error('503') });
    await openRetry(h);
    await waitFor(() => expect(h.calls).toEqual(['conflicts failed-1', 'retry failed-1']));
  });

  describe('the unfinished VM of a failed VM lab', () => {
    const leftover: RetryLeftover = { resourceName: failed.resourceName, provisionTaskId: 'failed-1' };

    it('removes it without asking, waits for the removal, then retries', async () => {
      const h = build({ leftover });
      await openRetry(h);
      await waitFor(() => expect(h.calls).toContain('retry failed-1'));
      expect(h.calls).toEqual([
        'conflicts failed-1',
        `remove ${failed.resourceName} -> failed-1 on agent-mac`,
        'wait rm-1',
        'done rm-1',
        'retry failed-1',
      ]);
      expect(screen.queryByText(/and retry\?/)).not.toBeInTheDocument();
      expect(h.alerts.some(a => a.message === 'Retrying task')).toBe(true);
    });

    it('ignores a second click on Retry while the first one is still removing the VM', async () => {
      const h = build({ leftover, hold: 'removal' });
      await renderPage(h);
      await clickRetry();
      await clickRetry(); // pressed again while the removal is still running
      expect(h.alerts.some(a => /already being retried/.test(a.message))).toBe(true);
      expect(h.calls).not.toContain('retry failed-1'); // still waiting for the removal
      h.release();
      await waitFor(() => expect(h.calls).toContain('retry failed-1'));
      expect(h.calls.filter(c => c.startsWith('retry'))).toEqual(['retry failed-1']);
      expect(h.calls.filter(c => c.startsWith('remove'))).toHaveLength(1);
      expect(h.alerts.some(a => /already being retried/.test(a.message))).toBe(true);
    });

    it('ignores a second click that arrives while the first is still reading what has to be cleaned up', async () => {
      const h = build({ leftover, hold: 'plan' });
      await renderPage(h);
      await clickRetry();
      await clickRetry(); // the plan of the first click has not come back yet
      h.release();
      await waitFor(() => expect(h.calls).toContain('retry failed-1'));
      expect(h.calls.filter(c => c.startsWith('conflicts'))).toHaveLength(1);
      expect(h.calls.filter(c => c.startsWith('retry'))).toEqual(['retry failed-1']);
    });

    it('does not retry, and says how to remove the VM by hand, when the removal fails', async () => {
      const h = build({ leftover, failRemoval: true });
      await openRetry(h);
      await waitFor(() => expect(h.alerts.some(a => a.severity === 'error')).toBe(true));
      const error = h.alerts.find(a => a.severity === 'error');
      expect(error.message).toContain('Could not remove the unfinished VM');
      expect(error.message).toContain('multipass delete --purge');
      expect(h.calls).not.toContain('retry failed-1');
    });
  });
});
