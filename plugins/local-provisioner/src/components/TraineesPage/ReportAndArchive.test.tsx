import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { TraineeListRow, TraineeRow } from '../../api/types';
import { buildLabReport } from '../../api/labReport';
import { DAY, detailRow, item, iso, keyOf, listRow, makeApi, renderPage, repoActivity } from './testKit';

jest.setTimeout(30_000);

const done = (id: string, over: any = {}) => ({
  id,
  capstone: 'nodejs-b',
  traineeNo: '07',
  status: 'completed',
  completedAt: iso(40 * DAY),
  completedBy: 'teacher@example.com',
  hasReport: true,
  archiveRetentionDays: 365,
  archiveExpiresAt: new Date(Date.now() + 10.5 * DAY).toISOString(),
  ...over,
});

/** Opens one trainee's panel with the extra API calls given; `row` is what the server's detail and list say. */
async function openPanel(row: TraineeRow, extra: Record<string, jest.Mock> = {}) {
  const { repo: _r, repoNote: _n, ...server } = row;
  const api = makeApi({
    rows: [listRow(row.resourceName, { ...row, hasGithubRepo: true } as any)],
    detail: () => server as TraineeRow,
    activity: keys => keys.map(k => item(k, { repo: row.repo ?? repoActivity() })),
    extra,
  });
  const page = await renderPage(api, `/local-provisioner/trainees?open=${encodeURIComponent(row.key)}`);
  const panel = await screen.findByLabelText('Trainee details');
  await within(panel).findByRole('tablist', undefined, { timeout: 5000 });
  return { api, panel, ...page };
}

describe('the lab report and marking a capstone done (in the panel)', () => {
  const active = () => detailRow('mia', { capstone: { id: 'e1', capstone: 'nodejs', traineeNo: '07', status: 'active' } });
  const finished = (over: any = {}) => detailRow('mia', { capstone: done('e1', over) });

  it('every trainee has a Report that opens the report; a lab without a capstone cannot be marked done', async () => {
    const { panel } = await openPanel(detailRow('ann'));
    fireEvent.click(within(panel).getByRole('button', { name: 'Report' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Lab report', level: 1 })).toBeInTheDocument();
    expect(within(dialog).getByText('Download report (.html)')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/ann@example\.com/).length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByText('Close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(panel).queryByText('Mark done')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Reopen')).not.toBeInTheDocument();
  });

  it('the report contains the GitHub work that the panel loaded', async () => {
    const { panel } = await openPanel(active());
    await within(panel).findByText('feat: S3 upload script');
    fireEvent.click(within(panel).getByRole('button', { name: 'Report' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Work: 6 commits, 7 of 10 tasks done/)).toBeInTheDocument();
  });

  it('Mark done asks first, keeps the report as completed, and reloads the list', async () => {
    const completeCapstone = jest.fn(async (_id: string, _report: any) => undefined);
    const { panel, api } = await openPanel(active(), { completeCapstone });
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Mark done' })).toBeEnabled());
    fireEvent.click(within(panel).getByText('Mark done'));
    expect(await screen.findByText('Mark this capstone done?')).toBeInTheDocument();
    expect(completeCapstone).not.toHaveBeenCalled();
    const listCalls = api.getTraineeList.mock.calls.length;
    fireEvent.click(screen.getByText('Mark done and keep the report'));
    await waitFor(() => expect(completeCapstone).toHaveBeenCalledTimes(1));
    const [id, report] = completeCapstone.mock.calls[0];
    expect(id).toBe('e1');
    expect(report).toMatchObject({ version: 1, trainee: 'mia@example.com', capstone: { id: 'e1', traineeNo: '07', status: 'completed' } });
    expect(report.repo).toMatchObject({ commits: 6, progress: { done: 7, total: 10 } }); // the GitHub summary is in what is kept
    await waitFor(() => expect(api.getTraineeList.mock.calls.length).toBeGreaterThan(listCalls));
  });

  it('Mark done tells the instructor it moves to the Archive and for how long it is kept', async () => {
    const { panel } = await openPanel(detailRow('mia', { capstone: { id: 'e1', capstone: 'nodejs', traineeNo: '07', status: 'active', archiveRetentionDays: 365 } }));
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Mark done' })).toBeEnabled());
    fireEvent.click(within(panel).getByText('Mark done'));
    expect(await screen.findByText(/It moves to the Archive and is deleted 1 year after today/)).toBeInTheDocument();
    expect(screen.getByText(/You can delete it earlier from the Archive, or reopen it/)).toBeInTheDocument();
  });

  it('Cancel marks nothing', async () => {
    const completeCapstone = jest.fn(async () => undefined);
    const { panel, api } = await openPanel(active(), { completeCapstone });
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Mark done' })).toBeEnabled());
    fireEvent.click(within(panel).getByText('Mark done'));
    fireEvent.click(await screen.findByText('Cancel'));
    await waitFor(() => expect(screen.queryByText('Mark this capstone done?')).not.toBeInTheDocument());
    expect(completeCapstone).not.toHaveBeenCalled();
    expect(api.getTraineeList).toHaveBeenCalledTimes(1);
  });

  it('a refusal from the server stays in the dialog and the list is not reloaded', async () => {
    const completeCapstone = jest.fn(async () => {
      throw new Error('Only an active capstone can be marked done');
    });
    const { panel, api } = await openPanel(active(), { completeCapstone });
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Mark done' })).toBeEnabled());
    fireEvent.click(within(panel).getByText('Mark done'));
    fireEvent.click(await screen.findByText('Mark done and keep the report'));
    expect(await screen.findByText('Not marked done: Only an active capstone can be marked done')).toBeInTheDocument();
    expect(screen.getByText('Mark this capstone done?')).toBeInTheDocument();
    expect(api.getTraineeList).toHaveBeenCalledTimes(1);
  });

  it('a finished capstone opens the KEPT report, cannot be marked done again, and Reopen asks first', async () => {
    const stored = { ...buildLabReport(finished()), summary: ['Kept when it was marked done: 71 of 76 automated points.'] };
    const getCapstoneReport = jest.fn(async (_id: string) => ({ report: stored, completedAt: iso(DAY), completedBy: 'ron@example.com' }));
    const reopenCapstone = jest.fn(async (_id: string) => undefined);
    const { panel, api } = await openPanel(finished(), { getCapstoneReport, reopenCapstone });
    expect(within(panel).queryByText('Mark done')).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByText('Final report'));
    expect(await screen.findByText('Kept when it was marked done: 71 of 76 automated points.')).toBeInTheDocument();
    expect(getCapstoneReport).toHaveBeenCalledWith('e1');
    fireEvent.click(screen.getByText('Close'));
    await waitFor(() => expect(screen.queryByText('Kept when it was marked done: 71 of 76 automated points.')).not.toBeInTheDocument());

    fireEvent.click(within(panel).getByText('Reopen'));
    expect(await screen.findByText('Reopen this capstone?')).toBeInTheDocument();
    expect(reopenCapstone).not.toHaveBeenCalled();
    const listCalls = api.getTraineeList.mock.calls.length;
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Reopen'));
    await waitFor(() => expect(reopenCapstone).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(api.getTraineeList.mock.calls.length).toBeGreaterThan(listCalls));
  });

  it('a finished capstone whose report was not kept falls back to the live report without asking the server', async () => {
    const getCapstoneReport = jest.fn();
    const { panel } = await openPanel(finished({ hasReport: false }), { getCapstoneReport });
    fireEvent.click(within(panel).getByRole('button', { name: 'Report' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(getCapstoneReport).not.toHaveBeenCalled();
  });

  it('a kept report that cannot be loaded says so and opens nothing', async () => {
    const getCapstoneReport = jest.fn(async () => {
      throw new Error('No report was kept for this capstone');
    });
    const { panel, post } = await openPanel(finished(), { getCapstoneReport });
    fireEvent.click(within(panel).getByText('Final report'));
    await waitFor(() => expect(post).toHaveBeenCalledWith({ message: 'Could not load the final report: No report was kept for this capstone', severity: 'error' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('an active capstone has no Reopen and no Final report', async () => {
    const { panel } = await openPanel(active());
    expect(within(panel).queryByText('Reopen')).not.toBeInTheDocument();
    expect(within(panel).queryByText('Final report')).not.toBeInTheDocument();
  });
});

/** The table's own tick boxes in order: 0 is "select all", then one per row. */
const rowBox = (index: number) => screen.getAllByRole('checkbox')[index];

describe('the Archive', () => {
  const mk = (name: string, over: any = {}, row: Partial<TraineeListRow> = {}): TraineeListRow =>
    listRow(name, { capstone: done(`e-${name}`, over), hasGithubRepo: true, ...row });
  const ann = mk('ann');
  const bob = mk('bob');
  const cy = mk('cy', {}, { agentId: undefined });
  const live = listRow('working', { capstone: { id: 'e-live', capstone: 'nodejs-b', traineeNo: '01', status: 'active' } });

  const render = async (rows: TraineeListRow[], extra: Record<string, jest.Mock> = {}, route = '/local-provisioner/trainees?tab=archive') => {
    const api = makeApi({ rows, extra, detail: key => ({ ...(rows.find(r => r.key === key) as any), events: [], checks: [] }) });
    const page = await renderPage(api, route);
    await screen.findAllByText(/^Archive \(/, undefined, { timeout: 5000 });
    return { api, ...page };
  };

  it('a capstone marked done leaves the Active list and shows in the Archive, with counts', async () => {
    const { params } = await render([live, ann, bob], {}, '/local-provisioner/trainees');
    expect(await screen.findByRole('tab', { name: 'Active (1)' })).toBeInTheDocument();
    expect(screen.queryByText('ann@example.com')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Archive (2)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Archive (2)' }));
    await waitFor(() => expect(params().get('tab')).toBe('archive'));
    expect(await screen.findByRole('tab', { name: 'Archive (2)', selected: true })).toBeInTheDocument();
    expect(screen.getByText('ann@example.com')).toBeInTheDocument();
    expect(screen.queryByText('working@example.com')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /^Active/ }));
    expect(await screen.findByText('working@example.com')).toBeInTheDocument();
  });

  it('a short Archive is not padded with a blank filler row either', async () => {
    await render([ann, bob]);
    await screen.findByText('ann@example.com');
    const bodyRows = Array.from(document.querySelectorAll('tbody tr'));
    expect(bodyRows).toHaveLength(2);
  });

  it('shows who marked it done, when it will be deleted and how many days are left, and costs no GitHub reads', async () => {
    const { api } = await render([ann]);
    expect(await screen.findByText('by teacher@example.com')).toBeInTheDocument();
    expect(screen.getByText('11 days left')).toBeInTheDocument();
    expect(screen.getByText('kept')).toBeInTheDocument();
    expect(api.getTraineeActivity).not.toHaveBeenCalled();
  });

  it('says how long the Archive is kept, from the portal setting', async () => {
    await render([ann]);
    expect(await screen.findByText(/kept for 1 year, then deleted/)).toBeInTheDocument();
  });

  it('follows a different setting', async () => {
    await render([mk('ann', { archiveRetentionDays: 90 })]);
    expect(await screen.findByText(/kept for 90 days, then deleted/)).toBeInTheDocument();
  });

  it('an empty Archive says what goes there', async () => {
    await render([live]);
    expect(await screen.findByText(/Nothing is archived/)).toBeInTheDocument();
  });

  it('the search applies to the Archive too', async () => {
    await render([ann, bob]);
    await screen.findByText('ann@example.com');
    fireEvent.change(screen.getByPlaceholderText('Filter'), { target: { value: 'bob' } });
    await waitFor(() => expect(screen.queryByText('ann@example.com')).not.toBeInTheDocument());
    expect(screen.getByText('bob@example.com')).toBeInTheDocument();
  });

  it('nothing can be deleted until something is ticked', async () => {
    await render([ann]);
    await screen.findByText('ann@example.com');
    expect(screen.queryByRole('button', { name: 'Delete selected' })).toBeNull();
    fireEvent.click(rowBox(1)); // the table's own tick boxes: the first is "select all", then one per row
    expect(await screen.findByRole('button', { name: 'Delete selected' })).toBeEnabled();
  });

  it('deletes only what is ticked, asks first, never deletes a repository, and reloads the list', async () => {
    const removeTrainee = jest.fn(async (_input: any) => ({ repoDeleted: undefined }));
    const { api } = await render([ann, bob, cy], { removeTrainee });
    await screen.findByText('ann@example.com');
    fireEvent.click(rowBox(1)); // ann
    fireEvent.click(rowBox(3)); // cy
    fireEvent.click(await screen.findByRole('button', { name: 'Delete selected' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete 2 archived capstones?')).toBeInTheDocument();
    expect(within(dialog).getByText('ann@example.com · nodejs-b #07')).toBeInTheDocument();
    expect(within(dialog).queryByText(/bob@example.com/)).not.toBeInTheDocument();
    expect(within(dialog).getByText(/GitHub repositories and the labs on their laptops are not touched/)).toBeInTheDocument();
    expect(removeTrainee).not.toHaveBeenCalled();
    const listCalls = api.getTraineeList.mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete 2' }));
    await waitFor(() => expect(removeTrainee).toHaveBeenCalledTimes(2));
    expect(removeTrainee).toHaveBeenCalledWith({ agentId: 'agent-ann', resourceName: 'ann', enrollmentId: 'e-ann', deleteRepo: false });
    expect(removeTrainee).toHaveBeenCalledWith({ agentId: undefined, resourceName: undefined, enrollmentId: 'e-cy', deleteRepo: false });
    await waitFor(() => expect(api.getTraineeList.mock.calls.length).toBeGreaterThan(listCalls));
    await waitFor(() => expect(screen.queryByText('Delete 2 archived capstones?')).not.toBeInTheDocument());
  });

  it('Select all ticks every archived capstone', async () => {
    await render([ann, bob]);
    await screen.findByText('ann@example.com');
    fireEvent.click(rowBox(0));
    expect(await screen.findByRole('button', { name: 'Delete selected' })).toBeEnabled();
    expect(screen.getAllByRole('checkbox').filter(b => (b as HTMLInputElement).checked)).toHaveLength(3); // both rows and "select all"
    fireEvent.click(rowBox(0));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete selected' })).toBeNull());
  });

  it('Cancel deletes nothing', async () => {
    const removeTrainee = jest.fn(async () => ({}));
    const { api } = await render([ann], { removeTrainee });
    await screen.findByText('ann@example.com');
    fireEvent.click(rowBox(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete selected' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(removeTrainee).not.toHaveBeenCalled();
    expect(api.getTraineeList).toHaveBeenCalledTimes(1);
  });

  it('when one fails the others are still deleted, the failure is listed and the dialog stays open', async () => {
    const removeTrainee = jest.fn(async (input: any) => {
      if (input.enrollmentId === 'e-bob') throw new Error('Lab not found');
      return {};
    });
    const { api, post } = await render([ann, bob], { removeTrainee });
    await screen.findByText('ann@example.com');
    fireEvent.click(rowBox(0));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete selected' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete 2' }));
    expect(await screen.findByText(/bob@example.com \(nodejs-b #07\): Lab not found/)).toBeInTheDocument();
    expect(screen.getByText('Delete 2 archived capstones?')).toBeInTheDocument();
    expect(removeTrainee).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenCalledWith({ message: 'Deleted 1 archived capstone', severity: 'success', display: 'transient' });
    await waitFor(() => expect(api.getTraineeList.mock.calls.length).toBeGreaterThan(1));
  });

  it('opening an archived row opens the panel with its kept report and Reopen', async () => {
    const { params } = await render([ann]);
    fireEvent.click(await screen.findByText('ann@example.com'));
    await waitFor(() => expect(params().get('open')).toBe(keyOf('ann')));
    const panel = await screen.findByLabelText('Trainee details');
    expect(await within(panel).findByText('Final report')).toBeInTheDocument();
    expect(within(panel).getByText('Reopen')).toBeInTheDocument();
  });

  it('ticking a row does not open it', async () => {
    const { params } = await render([ann]);
    await screen.findByText('ann@example.com');
    fireEvent.click(rowBox(1));
    expect(params().get('open')).toBeNull();
    expect(screen.queryByLabelText('Trainee details')).not.toBeInTheDocument();
  });
});
