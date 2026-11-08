import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { alertApiRef } from '@backstage/core-plugin-api';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import { ProvisioningTask } from '../../api/types';
import { LocalProvisionerPage } from './LocalProvisionerPage';

jest.setTimeout(30000);

/**
 * An instructor's check (a grade) is queued on the trainee's lab, so it sits in the trainee's own list. It shares the lab's
 * resource name, which is why the rows are told apart here by their type text. The trainee must not be offered Delete, Retry or a
 * checkbox on it, and "select all" must neither select it nor miscount (audit 2026-11-07: a trainee could delete finished checks,
 * which erased the instructor's grade history).
 */
const base = { agentId: 'agent-mac', userId: 'ron@example.com', config: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
const lab: ProvisioningTask = { ...base, id: 'lab-1', taskType: 'provision-training', resourceName: 'py-capstone-ron', config: { labId: 'python-capstone-a' }, status: 'completed' };
const oldLab: ProvisioningTask = { ...base, id: 'lab-0', taskType: 'provision-training', resourceName: 'old-lab', config: { labId: 'x' }, status: 'failed', errorMessage: 'boom' };
const checkDone: ProvisioningTask = { ...base, id: 'chk-1', taskType: 'run-check', resourceName: 'py-capstone-ron', config: { checkName: 'grade', targetTaskId: 'lab-1' }, status: 'completed' };
const checkFailed: ProvisioningTask = { ...base, id: 'chk-2', taskType: 'run-check', resourceName: 'py-capstone-ron', config: { checkName: 'grade', targetTaskId: 'lab-1' }, status: 'failed', errorMessage: 'The check did not complete.' };

function build(deleted: string[]) {
  const api: any = {
    getTasks: async () => [lab, oldLab, checkDone, checkFailed],
    getResources: async () => [],
    getAgents: async () => [],
    getAgentStatus: async () => null,
    deleteTask: async (id: string) => {
      deleted.push(id);
    },
  };
  const alertApi: any = { post: jest.fn(), alert$: () => ({ subscribe: () => ({ unsubscribe() {} }) }) };
  return { api, alertApi };
}

async function renderPage(deleted: string[]) {
  const h = build(deleted);
  await renderInTestApp(
    <TestApiProvider apis={[[localProvisionerApiRef, h.api], [alertApiRef, h.alertApi]]}>
      <LocalProvisionerPage />
    </TestApiProvider>,
  );
  await screen.findByText('old-lab');
}

const rowByType = (typeText: RegExp, resource: string) => {
  const rows = screen.getAllByText(resource).map(el => el.closest('tr') as HTMLElement);
  const row = rows.find(r => typeText.test(r.textContent ?? ''));
  if (!row) throw new Error(`no row for ${resource} matching ${typeText}`);
  return row;
};
const openMenu = (row: HTMLElement) => fireEvent.click(within(row).getByLabelText('actions'));
const checkRows = () => screen.getAllByText('py-capstone-ron').map(el => el.closest('tr') as HTMLElement).filter(r => /run-check/.test(r.textContent ?? ''));

describe('LocalProvisionerPage — instructor checks in the trainee\'s list', () => {
  it('shows the check rows (the trainee can see them) but with no selection checkbox', async () => {
    await renderPage([]);
    const rows = checkRows();
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(within(r).queryByRole('checkbox')).toBeNull();
    // ordinary rows keep theirs
    expect(within(rowByType(/provision-training|python-capstone-a/, 'py-capstone-ron')).getByRole('checkbox')).toBeInTheDocument();
  });

  it('offers no "Delete task" and no "Retry" on a check row, even a failed one', async () => {
    await renderPage([]);
    const failedCheck = checkRows().find(r => /failed/.test(r.textContent ?? ''))!;
    openMenu(failedCheck);
    expect(await screen.findByText('View details')).toBeInTheDocument();
    expect(screen.queryByText('Delete task')).toBeNull();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('still offers Delete and Retry on an ordinary failed task', async () => {
    await renderPage([]);
    openMenu(rowByType(/failed/, 'old-lab'));
    expect(await screen.findByText('Delete task')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('"select all" selects only the ordinary rows, counts them right, and deletes none of the checks', async () => {
    const deleted: string[] = [];
    await renderPage(deleted);
    const header = screen.getByLabelText('select all tasks') as HTMLInputElement;
    fireEvent.click(header);
    // 2 ordinary rows (the lab and old-lab) are selected; the header reads "all selected", not "indeterminate".
    await waitFor(() => expect(header.checked).toBe(true));
    expect(header.indeterminate).toBe(false);
    const deleteSelected = await screen.findByText(/Delete 2/);
    fireEvent.click(deleteSelected);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(deleted.sort()).toEqual(['lab-0', 'lab-1']));
    expect(deleted).not.toContain('chk-1');
    expect(deleted).not.toContain('chk-2');
  });

  it('a second click on the header clears the selection (the arithmetic does not strand it)', async () => {
    await renderPage([]);
    const header = screen.getByLabelText('select all tasks') as HTMLInputElement;
    fireEvent.click(header);
    await waitFor(() => expect(header.checked).toBe(true));
    fireEvent.click(header);
    await waitFor(() => expect(header.checked).toBe(false));
    expect(header.indeterminate).toBe(false);
  });
});
