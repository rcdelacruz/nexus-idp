import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { TraineeListRow, TraineeRow } from '../../api/types';
import { detailRow, gate, item, ActivityFn, makeApi, renderPage, repoActivity, listRow, KitOptions } from './testKit';

jest.setTimeout(30_000);

/** The list row the server would send for this detail. */
const toListRow = (d: TraineeRow): TraineeListRow => listRow(d.resourceName, { ...d, hasGithubRepo: true } as any);

/** Opens the panel the way a link does: `?open=<key>`. The server's detail carries no GitHub data; that comes from `activity`. */
async function openPanel(detail: TraineeRow, extra: Record<string, jest.Mock> = {}, opts: { activity?: ActivityFn; repo?: ReturnType<typeof repoActivity> | null; detail?: KitOptions['detail'] } = {}) {
  const { repo: _r, repoNote: _n, ...serverDetail } = detail;
  const repo = opts.repo === undefined ? detail.repo ?? repoActivity() : opts.repo;
  const kit: KitOptions = {
    rows: [toListRow(detail)],
    detail: opts.detail ?? (() => serverDetail as TraineeRow),
    activity: opts.activity ?? ((keys, level) => keys.map(k => (repo ? item(k, { repo }) : item(k, { code: 'no_repo', repo: undefined, note: 'No repository recorded for this environment' })))),
    extra,
  };
  const api = makeApi(kit);
  const page = await renderPage(api, `/local-provisioner/trainees?open=${encodeURIComponent(detail.key)}`);
  const panel = await screen.findByLabelText('Trainee details');
  await within(panel).findByRole('tablist', undefined, { timeout: 5000 });
  return { api, panel, ...page };
}
const tab = (panel: HTMLElement, name: string) => fireEvent.click(within(panel).getByRole('tab', { name }));

describe('TraineePanel — what it loads', () => {
  it('loads the detail from the database and the full GitHub summary separately, once each', async () => {
    const { api, panel } = await openPanel(detailRow('ann'));
    expect(within(panel).getByText('ann@example.com')).toBeInTheDocument();
    expect(api.getTraineeDetail).toHaveBeenCalledTimes(1);
    const full = api.getTraineeActivity.mock.calls.filter(c => c[1] === 'full');
    expect(full).toHaveLength(1);
    expect(full[0][0]).toEqual(['lab:agent-ann::ann']);
    expect(full[0][2]).toBe(false);
  });

  it('shows the work in the repository once GitHub has answered', async () => {
    const { panel } = await openPanel(detailRow('ann'));
    expect(await within(panel).findByText('feat: S3 upload script')).toBeInTheDocument();
    expect(within(panel).getByText('7/10')).toBeInTheDocument();
    expect(within(panel).getByText('CORRECTIONS')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /Repository/ })).toHaveAttribute('href', 'https://github.com/o/r');
    expect(within(panel).getByRole('link', { name: /Latest CI run/ })).toBeInTheDocument();
    // MUI gives a router link the role "button"; it is still a link to the catalog page.
    expect(within(panel).getByRole('button', { name: 'Catalog' })).toHaveAttribute('href', '/catalog/default/resource/ann');
  });

  it('the detail does not wait for GitHub: the trainee is on screen while the repository is still loading', async () => {
    const hold = gate<void>();
    const { panel } = await openPanel(detailRow('ann'), {}, { activity: async keys => { await hold.promise; return keys.map(k => item(k)); } });
    expect(within(panel).getByText('Loading the repository from GitHub…')).toBeInTheDocument();
    expect(within(panel).getByRole('tab', { name: 'History' })).toBeInTheDocument();
    hold.resolve();
    expect(await within(panel).findByText('feat: S3 upload script')).toBeInTheDocument();
  });

  it('a trainee that is no longer on the list says so', async () => {
    const api = makeApi({ rows: [listRow('bbb')], detail: () => null });
    await renderPage(api, `/local-provisioner/trainees?open=${encodeURIComponent('lab:agent-gone::gone')}`);
    expect(await screen.findByText(/no longer on the list/)).toBeInTheDocument();
  });

  it('a detail that cannot be loaded says why', async () => {
    const api = makeApi({ rows: [listRow('bbb')] });
    api.getTraineeDetail.mockRejectedValue(new Error('Failed to load the trainee: Internal Server Error'));
    await renderPage(api, `/local-provisioner/trainees?open=${encodeURIComponent(listRow('bbb').key)}`);
    expect(await screen.findByText(/Could not load this trainee: Failed to load the trainee: Internal Server Error/)).toBeInTheDocument();
  });

  it('Close takes the trainee out of the address', async () => {
    const { panel, params } = await openPanel(detailRow('ann'));
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(params().get('open')).toBeNull());
  });

  it('the History tab lists the lab’s timeline', async () => {
    const { panel } = await openPanel(detailRow('ann', { events: [{ type: 'provision-training', status: 'completed', at: '2026-11-01T09:00:00Z' }, { type: 'stop', status: 'completed', at: '2026-11-02T09:00:00Z' }] }));
    tab(panel, 'History');
    expect(await within(panel).findByText('stop')).toBeInTheDocument();
    expect(within(panel).getAllByText('completed').length).toBeGreaterThan(0);
    expect(within(panel).getByText('provision-training')).toBeInTheDocument();
  });

  it('a lab with no instructor checks says so; a plain lab has no Capstone tab', async () => {
    const { panel } = await openPanel(detailRow('ann'));
    expect(within(panel).queryByRole('tab', { name: 'Capstone' })).not.toBeInTheDocument();
    tab(panel, 'Checks');
    expect(await within(panel).findByText('This lab has no instructor checks.')).toBeInTheDocument();
  });
});

describe('TraineePanel — the repository summary and Mark done', () => {
  const mia = () => detailRow('mia', { capstone: { id: 'e1', capstone: 'nodejs', traineeNo: '07', status: 'active' } });

  it('Mark done waits for the repository summary, then opens', async () => {
    const hold = gate<void>();
    const { panel } = await openPanel(mia(), {}, { activity: async keys => { await hold.promise; return keys.map(k => item(k)); } });
    const markDone = within(panel).getByRole('button', { name: 'Mark done' });
    expect(markDone).toBeDisabled();
    expect(markDone).toHaveAttribute('title', expect.stringMatching(/Waiting for the repository summary/));
    hold.resolve();
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Mark done' })).toBeEnabled());
  });

  it('when GitHub cannot be read, Mark done stays off, a Retry is offered, and it works once GitHub answers', async () => {
    let fail = true;
    const { panel, api } = await openPanel(mia(), {}, { activity: keys => keys.map(k => (fail ? item(k, { code: 'unavailable', repo: undefined, note: 'Could not read the repository from GitHub' }) : item(k))) });
    expect(await within(panel).findByText(/GitHub data could not be loaded: Could not read the repository from GitHub/)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Mark done' })).toBeDisabled();
    fail = false;
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Mark done' })).toBeEnabled());
    const retry = api.getTraineeActivity.mock.calls.filter(c => c[1] === 'full').pop()!;
    expect(retry[2]).toBe(true); // the retry asks GitHub again, it does not accept the remembered failure
  });

  it('a rate limit is a failure to retry, not an answer', async () => {
    const { panel } = await openPanel(mia(), {}, { activity: keys => keys.map(k => item(k, { code: 'rate_limited', repo: undefined })) });
    expect(await within(panel).findByText(/GitHub data could not be loaded/)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Mark done' })).toBeDisabled();
  });

  it('with no repository at all, Mark done is open (there is nothing to wait for) and the panel says so', async () => {
    const { panel } = await openPanel(mia(), {}, { repo: null });
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Mark done' })).toBeEnabled());
    expect(await within(panel).findByText('No repository recorded for this environment')).toBeInTheDocument();
  });

  it('a repository GitHub says is not found is also settled: Mark done is open', async () => {
    const { panel } = await openPanel(mia(), {}, { activity: keys => keys.map(k => item(k, { code: 'not_found', repo: undefined, note: 'Repository not found (deleted, or the portal has no access)' })) });
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Mark done' })).toBeEnabled());
  });
});

describe('TraineePanel — capstone actions', () => {
  const mia = (over: any = {}) => detailRow('mia', { taskType: 'capstone', capstone: { id: 'e1', capstone: 'nodejs', traineeNo: '07', status: 'active', ...over } });

  it('sends the handout, reloads, and shows the instructor-only data with the answer key rendered as text', async () => {
    const openCapstoneHandout = jest.fn(async () => ({ prUrl: 'https://github.com/x/pull/1', created: true }));
    const getCapstoneSecrets = jest.fn(async () => ({
      credentials: 'admin login : admin@kalye.kitchen / s3cret',
      answerKey: '# Handover answers\n\nThe **race condition** is in `orders.ts`.\n\n- first fault\n- second fault\n\n<script>alert(1)</script>',
      seedManifest: { trainee: '07' },
      gradeCommand: 'node instructor/seed/grade.mjs --manifest m.json',
    }));
    const { panel, api } = await openPanel(mia(), { openCapstoneHandout, getCapstoneSecrets });
    tab(panel, 'Capstone');
    expect(await within(panel).findByText('Day-4 handout')).toBeInTheDocument();
    fireEvent.click(within(panel).getByText('Send Day-4 handout'));
    fireEvent.click(await screen.findByText('Open PR'));
    await waitFor(() => expect(openCapstoneHandout).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(api.getTraineeList.mock.calls.length).toBeGreaterThan(1)); // the list was reloaded
    await waitFor(() => expect(api.getTraineeDetail.mock.calls.length).toBeGreaterThan(1)); // and the trainee

    fireEvent.click(within(panel).getByText('Instructor data'));
    expect(await screen.findByText('admin login : admin@kalye.kitchen / s3cret')).toBeInTheDocument();
    expect(screen.getByText('node instructor/seed/grade.mjs --manifest m.json')).toBeInTheDocument();
    const key = screen.getByTestId('answer-key');
    expect(within(key).getByRole('heading', { name: 'Handover answers' })).toBeInTheDocument();
    expect(within(key).getByText('race condition').tagName).toBe('STRONG');
    expect(within(key).getByText('orders.ts').tagName).toBe('CODE');
    expect(within(key).getAllByRole('listitem').map(li => li.textContent)).toEqual(['first fault', 'second fault']);
    expect(key).not.toHaveTextContent('# Handover answers');
    expect(key.querySelector('script')).toBeNull();
  });

  it('after an action the panel shows what the server now says, not what it showed before', async () => {
    const openCapstoneHandout = jest.fn(async () => ({ prUrl: 'https://github.com/x/pull/1', created: true }));
    const before = mia();
    const after = mia({ handoutPrUrl: 'https://github.com/x/pull/1', handoutAt: '2026-11-07T10:00:00Z' });
    let asked = 0;
    const { panel } = await openPanel(before, { openCapstoneHandout }, { detail: () => (asked++ === 0 ? before : after) });
    tab(panel, 'Capstone');
    expect(await within(panel).findByText('Send Day-4 handout')).toBeInTheDocument();
    expect(within(panel).queryByText(/Re-send/)).toBeNull();
    fireEvent.click(within(panel).getByText('Send Day-4 handout'));
    fireEvent.click(await screen.findByText('Open PR'));
    expect(await within(panel).findByText('Re-send Day-4 handout')).toBeInTheDocument();
    expect(within(panel).getByText(/PR opened/)).toBeInTheDocument();
  });

  it('uses the capstone’s own handout label and instructions (Capstone A: a client change request)', async () => {
    const { panel } = await openPanel(mia({ capstone: 'nodejs-a', handout: { label: 'Day-3 change request', instructions: "Opens the client's holiday-pricing change request." } }));
    tab(panel, 'Capstone');
    expect(await within(panel).findByText('Day-3 change request')).toBeInTheDocument();
    fireEvent.click(within(panel).getByText('Send Day-3 change request'));
    expect(await screen.findByText("mia@example.com: Opens the client's holiday-pricing change request.")).toBeInTheDocument();
    expect(screen.queryByText(/sabotaged/)).not.toBeInTheDocument();
  });

  it('shows the seed state and disables instructor data until the laptop reports', async () => {
    const { panel } = await openPanel(mia({ capstone: 'terraform', awaitingSeedReport: true }));
    tab(panel, 'Capstone');
    expect(await within(panel).findByText(/waiting for the trainee's lab to seed and report/)).toBeInTheDocument();
    expect(within(panel).getByText('Instructor data').closest('button')).toBeDisabled();
  });
});

describe('TraineePanel — remove trainee', () => {
  const setup = async (row: TraineeRow, removeTrainee = jest.fn(async (_input: any) => ({ repoDeleted: 'example-org/x' }))) => {
    const r = await openPanel(row, { removeTrainee });
    return { ...r, removeTrainee };
  };

  it('removes a lab row and deletes its repo after confirmation, closes the panel and reloads', async () => {
    const row = detailRow('ann', { environment: { state: 'removed', updatedAt: '2026-10-30T09:00:00Z', agentOnline: false } });
    const { api, panel, removeTrainee, params } = await setup(row);
    const openBtn = within(panel).getByText('Remove trainee').closest('button')!;
    expect(openBtn).toHaveAttribute('data-destructive'); // red comes from overrides.css [data-destructive]
    fireEvent.click(openBtn);
    expect(await screen.findByText(`Remove ${row.traineeEmail}?`)).toBeInTheDocument();
    expect(screen.getByText('o/ann')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(removeTrainee).not.toHaveBeenCalled();
    const listCalls = api.getTraineeList.mock.calls.length;
    const confirm = screen.getByText('Remove and delete repository').closest('button')!;
    expect(confirm).toHaveAttribute('data-destructive');
    fireEvent.click(confirm);
    await waitFor(() => expect(removeTrainee).toHaveBeenCalledWith({ agentId: 'agent-ann', resourceName: 'ann', enrollmentId: undefined, deleteRepo: true }));
    await waitFor(() => expect(api.getTraineeList.mock.calls.length).toBeGreaterThan(listCalls));
    await waitFor(() => expect(params().get('open')).toBeNull());
  });

  it('keeps the repo when unticked, and withdraws a capstone-only enrollment by id', async () => {
    const row = detailRow('gone', {
      key: 'cap:e9',
      agentId: undefined,
      taskType: 'capstone',
      environment: { state: 'none', updatedAt: '2026-10-30T09:00:00Z', agentOnline: false },
      capstone: { id: 'e9', capstone: 'nodejs', traineeNo: '01', status: 'active', awaitingSeedReport: false },
    });
    const { panel, removeTrainee } = await setup(row);
    fireEvent.click(within(panel).getByText('Remove trainee'));
    expect(await screen.findByText(/withdraws their nodejs capstone enrollment/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Remove').closest('button')!);
    await waitFor(() => expect(removeTrainee).toHaveBeenCalledWith({ agentId: undefined, resourceName: undefined, enrollmentId: 'e9', deleteRepo: false }));
  });

  it("warns that a live lab stays on the trainee's laptop", async () => {
    const { panel } = await setup(detailRow('ann'));
    fireEvent.click(within(panel).getByText('Remove trainee'));
    expect(await screen.findByText(/still on their laptop \(running\)/)).toBeInTheDocument();
  });

  it('shows why when the server refuses, and keeps the dialog open', async () => {
    const removeTrainee = jest.fn(async () => {
      throw new Error("The repository was not deleted: backstage-main is not named after this trainee's lab. Nothing was removed.");
    });
    const { panel } = await setup(detailRow('ann'), removeTrainee as any);
    fireEvent.click(within(panel).getByText('Remove trainee'));
    fireEvent.click(await screen.findByText('Remove and delete repository'));
    expect(await screen.findByText(/Not removed: The repository was not deleted/)).toBeInTheDocument();
    expect(screen.getByText('Remove ann@example.com?')).toBeInTheDocument();
  });
});

describe('TraineePanel — lab checks and their Details', () => {
  const base = () =>
    detailRow('mia', {
      capstone: {
        id: 'e9',
        capstone: 'terraform-a',
        traineeNo: '05',
        status: 'active',
        availableChecks: [
          { name: 'grade', title: 'Grade (in the trainee lab)' },
          { name: 'seeded-resources', title: 'Seeded resources intact' },
        ],
      },
    });
  const failedGrade = { name: 'grade', status: 'failed', at: '2026-11-05T09:30:00Z', exitCode: 1, error: 'Job exited with 1', output: 'Job exited with 1', logs: 'terraform init\nno such host registry.terraform.io' };
  const okSeeded = { name: 'seeded-resources', status: 'completed', at: '2026-11-05T09:00:00Z', exitCode: 0, output: '{"checked":12,"missing":[]}' };
  const withChecks = (checks: any[]) => ({ ...base(), checks });
  const open = async (row: TraineeRow, extra: Record<string, jest.Mock> = {}) => {
    const r = await openPanel(row, extra);
    tab(r.panel, 'Checks');
    return r;
  };

  it('runs a check on a running lab and shows the latest result', async () => {
    const runCapstoneCheck = jest.fn(async () => ({ taskId: 't9' }));
    const row = detailRow('tf2', {
      checks: [{ name: 'seeded-resources', status: 'failed', at: '2026-10-30T10:00:00Z', exitCode: 1, output: '{"checked": 12, "missing": ["rds.instance"]}' }],
      capstone: { id: 'e3', capstone: 'terraform', traineeNo: '04', status: 'active', seedReportedAt: '2026-10-30T08:00:00Z', availableChecks: [{ name: 'seeded-resources', title: 'Seeded prod resources intact (hard fail #1)' }] },
    });
    const { panel } = await open(row, { runCapstoneCheck });
    expect(await within(panel).findByText('Seeded prod resources intact (hard fail #1)')).toBeInTheDocument();
    expect(within(panel).getByText(/1 of 12 missing or replaced: rds.instance/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByText('Run'));
    await waitFor(() => expect(runCapstoneCheck).toHaveBeenCalledWith('e3', 'seeded-resources'));
  });

  it('Run is off while the lab is not running', async () => {
    const row = { ...withChecks([]), environment: { state: 'stopped', updatedAt: '2026-11-05T09:00:00Z', agentOnline: false } } as TraineeRow;
    const { panel } = await open(row);
    expect((await within(panel).findAllByText('Run'))[0].closest('button')).toBeDisabled();
  });

  it('a failed grade says failed with its exit code, and Details opens the reason and the log', async () => {
    const { panel } = await open(withChecks([failedGrade, okSeeded]) as TraineeRow);
    expect(await within(panel).findByText(/failed \(exit 1\)/)).toBeInTheDocument();
    expect(within(panel).queryByText(/did not run/)).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'Details of Grade (in the trainee lab)' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('What the agent reported')).toBeInTheDocument();
    expect(within(dialog).getByTestId('check-log')).toHaveTextContent('no such host registry.terraform.io');
  });

  it('each check opens its own result', async () => {
    const { panel } = await open(withChecks([failedGrade, okSeeded]) as TraineeRow);
    fireEvent.click(await within(panel).findByRole('button', { name: 'Details of Seeded resources intact' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('check-output')).toHaveTextContent('"checked":12');
    expect(within(dialog).queryByTestId('check-log')).not.toBeInTheDocument();
  });

  it('no Details button for a check that has not run or is still running', async () => {
    const { panel } = await open(withChecks([{ name: 'grade', status: 'in-progress', at: '2026-11-05T09:30:00Z' }]) as TraineeRow);
    expect(await within(panel).findByText(/running…/)).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /Details of/ })).not.toBeInTheDocument();
  });

  it('Details is for the newest result of the check', async () => {
    const older = { ...failedGrade, at: '2026-11-04T09:30:00Z', logs: 'OLD RUN LOG' };
    const { panel } = await open(withChecks([{ ...failedGrade, logs: 'NEWEST RUN LOG' }, older]) as TraineeRow);
    fireEvent.click(await within(panel).findByRole('button', { name: 'Details of Grade (in the trainee lab)' }));
    expect(await screen.findByTestId('check-log')).toHaveTextContent('NEWEST RUN LOG');
    expect(screen.getByTestId('check-log')).not.toHaveTextContent('OLD RUN LOG');
  });
});
