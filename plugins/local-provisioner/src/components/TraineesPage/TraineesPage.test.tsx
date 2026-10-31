import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { TraineesPage, relativeTime, checkSummary } from './TraineesPage';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import { TraineeRow } from '../../api/types';

const days = Array.from({ length: 14 }, (_, i) => ({ date: `2026-10-${String(17 + i).padStart(2, '0')}`, count: i === 13 ? 3 : 0 }));

const worked: TraineeRow = {
  traineeEmail: 'jane.doe@example.com',
  resourceName: 'ministack-jane-20261030-1730',
  lab: 'ministack',
  taskType: 'provision-training',
  environment: { state: 'running', updatedAt: '2026-10-30T09:00:00Z', agentOnline: true },
  events: [{ type: 'provision-training', status: 'completed', at: '2026-10-30T09:00:00Z' }],
  catalogEntityRef: 'resource:default/ministack-jane-20261030-1730',
  repoUrl: 'https://github.com/stratpoint-engineering/training-ministack-jane-20261030-1730',
  repo: {
    owner: 'stratpoint-engineering',
    repo: 'training-ministack-jane-20261030-1730',
    htmlUrl: 'https://github.com/stratpoint-engineering/training-ministack-jane-20261030-1730',
    empty: false,
    commitCount: 4,
    lastCommit: { sha: 'abcdef1234', message: 'feat: MS-02 S3 upload script', date: '2026-10-30T10:00:00Z', author: 'jane' },
    commitsPerDay: days,
    stageFilesWorked: ['CORRECTIONS', 'PROGRESS'],
    aiLogFiles: 2,
    corrections: 3,
    decisions: 1,
    progress: { done: 2, total: 10 },
    pullRequests: { open: 1, merged: 2 },
    ci: { status: 'completed', conclusion: 'success', updatedAt: '2026-10-30T10:05:00Z', htmlUrl: 'https://github.com/x/actions/runs/1' },
  },
};
const gitlab: TraineeRow = {
  ...worked,
  traineeEmail: 'juan@example.com',
  resourceName: 'devops-capstone-juan',
  lab: 'devops-capstone-training',
  environment: { state: 'stopped', updatedAt: '2026-10-29T09:00:00Z', agentOnline: false, agentLastSeen: '2026-10-29T09:00:00Z' },
  repo: undefined,
  repoNote: 'Not a GitHub repository (GitLab track): no activity data',
};

const renderWith = (getTrainees: () => Promise<TraineeRow[]>) =>
  renderInTestApp(
    <TestApiProvider apis={[[localProvisionerApiRef, { getTrainees } as any]]}>
      <TraineesPage />
    </TestApiProvider>,
  );

describe('TraineesPage', () => {
  it('lists each trainee with environment, progress and repo activity, and expands a row', async () => {
    await renderWith(async () => [worked, gitlab]);

    expect(await screen.findByText('jane.doe@example.com')).toBeInTheDocument();
    expect(screen.getByText('Trainees (2)')).toBeInTheDocument();
    expect(screen.getByText('2/10')).toBeInTheDocument();
    expect(screen.getByText('feat: MS-02 S3 upload script')).toBeInTheDocument();
    expect(screen.getByText('1 open · 2 merged')).toBeInTheDocument();
    expect(screen.getByText('passing')).toBeInTheDocument();
    expect(screen.getByText('agent online')).toBeInTheDocument();
    expect(screen.getByText(/agent offline/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('jane.doe@example.com'));
    expect(await screen.findByText('Stage files worked on')).toBeInTheDocument();
    expect(screen.getByText('CORRECTIONS')).toBeInTheDocument();
    expect(screen.getByText('Repository').closest('a')).toHaveAttribute('href', worked.repo!.htmlUrl);

    fireEvent.click(screen.getByText('juan@example.com'));
    expect(await screen.findByText('Not a GitHub repository (GitLab track): no activity data')).toBeInTheDocument();
  });

  it('filters by trainee or lab', async () => {
    await renderWith(async () => [worked, gitlab]);
    await screen.findByText('jane.doe@example.com');
    fireEvent.change(screen.getByPlaceholderText('Filter by trainee or lab'), { target: { value: 'capstone' } });
    expect(screen.queryByText('jane.doe@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('juan@example.com')).toBeInTheDocument();
  });

  it('tells non-instructors the view is not for them on 403', async () => {
    await renderWith(async () => {
      throw Object.assign(new Error('Access denied'), { status: 403 });
    });
    expect(await screen.findByText('The Trainees view is for instructors and admins.')).toBeInTheDocument();
  });

  it('shows an empty state when nobody has provisioned a lab', async () => {
    await renderWith(async () => []);
    expect(await screen.findByText('No one has provisioned a training lab yet.')).toBeInTheDocument();
  });
});

describe('TraineesPage — capstone rows', () => {
  const capstoneRow: TraineeRow = {
    ...worked,
    traineeEmail: 'mia@example.com',
    resourceName: 'nodejs-capstone-mia',
    lab: 'nodejs-capstone',
    taskType: 'capstone',
    environment: { state: 'none', updatedAt: '2026-10-30T09:00:00Z', agentOnline: false },
    capstone: { id: 'e1', capstone: 'nodejs', traineeNo: '07', status: 'active' },
  };

  it('shows the trainee number, no environment, and runs the instructor actions', async () => {
    const openCapstoneHandout = jest.fn(async () => ({ prUrl: 'https://github.com/x/pull/1', created: true }));
    const getCapstoneSecrets = jest.fn(async () => ({
      credentials: 'admin login : admin@kalye.kitchen / s3cret',
      answerKey: '# handover with answers',
      seedManifest: { trainee: '07' },
      gradeCommand: 'node instructor/seed/grade.mjs --manifest m.json',
    }));
    const getTrainees = jest.fn(async () => [capstoneRow]);
    await renderInTestApp(
      <TestApiProvider apis={[[localProvisionerApiRef, { getTrainees, openCapstoneHandout, getCapstoneSecrets } as any]]}>
        <TraineesPage />
      </TestApiProvider>,
    );
    expect(await screen.findByText('trainee #07')).toBeInTheDocument();
    expect(screen.getByText('no environment')).toBeInTheDocument();

    fireEvent.click(screen.getByText('mia@example.com'));
    expect(await screen.findByText('Day-4 handout:', { exact: false })).toBeInTheDocument();

    fireEvent.click(screen.getByText('Send Day-4 handout'));
    fireEvent.click(await screen.findByText('Open PR'));
    await waitFor(() => expect(openCapstoneHandout).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(getTrainees).toHaveBeenLastCalledWith({ refresh: true }));

    fireEvent.click(screen.getByText('Instructor data'));
    expect(await screen.findByText('admin login : admin@kalye.kitchen / s3cret')).toBeInTheDocument();
    expect(screen.getByText('node instructor/seed/grade.mjs --manifest m.json')).toBeInTheDocument();
  });
});

describe('TraineesPage — laptop-seeded capstone', () => {
  it('shows the seed state and disables instructor data until the laptop reports', async () => {
    const row: TraineeRow = {
      ...worked,
      traineeEmail: 'tf@example.com',
      lab: 'terraform-capstone',
      capstone: { id: 'e2', capstone: 'terraform', traineeNo: '03', status: 'active', awaitingSeedReport: true },
    };
    await renderInTestApp(
      <TestApiProvider apis={[[localProvisionerApiRef, { getTrainees: async () => [row] } as any]]}>
        <TraineesPage />
      </TestApiProvider>,
    );
    fireEvent.click(await screen.findByText('tf@example.com'));
    expect(await screen.findByText(/waiting for the trainee's lab to seed and report/)).toBeInTheDocument();
    expect(screen.getByText('Instructor data').closest('button')).toBeDisabled();
  });
});

describe('TraineesPage — remove trainee', () => {
  const setup = async (row: TraineeRow, removeTrainee = jest.fn(async (_input: any) => ({ repoDeleted: 'stratpoint-engineering/x' }))) => {
    const getTrainees = jest.fn(async () => [row]);
    await renderInTestApp(
      <TestApiProvider apis={[[localProvisionerApiRef, { getTrainees, removeTrainee } as any]]}>
        <TraineesPage />
      </TestApiProvider>,
    );
    fireEvent.click(await screen.findByText(row.traineeEmail));
    return { getTrainees, removeTrainee };
  };

  it('removes a lab row and deletes its repo after confirmation, then reloads', async () => {
    const row: TraineeRow = { ...worked, agentId: 'a1', environment: { ...worked.environment, state: 'removed' } };
    const { getTrainees, removeTrainee } = await setup(row);

    const open = screen.getByText('Remove trainee').closest('button')!;
    // Red comes from overrides.css [data-destructive]; it must reach the DOM button.
    expect(open).toHaveAttribute('data-destructive');
    fireEvent.click(open);
    expect(await screen.findByText(`Remove ${row.traineeEmail}?`)).toBeInTheDocument();
    expect(screen.getByText('stratpoint-engineering/training-ministack-jane-20261030-1730')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(removeTrainee).not.toHaveBeenCalled();

    const calls = getTrainees.mock.calls.length;
    const confirm = screen.getByText('Remove and delete repository').closest('button')!;
    expect(confirm).toHaveAttribute('data-destructive');
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(removeTrainee).toHaveBeenCalledWith({ agentId: 'a1', resourceName: row.resourceName, enrollmentId: undefined, deleteRepo: true }),
    );
    await waitFor(() => expect(getTrainees.mock.calls.length).toBeGreaterThan(calls));
  });

  it('keeps the repo when unticked, and withdraws a capstone-only enrollment by id', async () => {
    const row: TraineeRow = {
      ...worked,
      traineeEmail: 'gone@example.com',
      resourceName: 'nodejs-capstone-gone-1',
      lab: 'nodejs-capstone',
      taskType: 'capstone',
      environment: { state: 'none', updatedAt: '2026-10-30T09:00:00Z', agentOnline: false },
      capstone: { id: 'e9', capstone: 'nodejs', traineeNo: '01', status: 'active', awaitingSeedReport: false },
    };
    const { removeTrainee } = await setup(row);
    fireEvent.click(screen.getByText('Remove trainee'));
    expect(await screen.findByText(/withdraws their nodejs capstone enrollment/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Remove').closest('button')!);
    await waitFor(() =>
      expect(removeTrainee).toHaveBeenCalledWith({ agentId: undefined, resourceName: undefined, enrollmentId: 'e9', deleteRepo: false }),
    );
  });

  it("warns that a live lab stays on the trainee's laptop", async () => {
    await setup({ ...worked, agentId: 'a1' }); // state: running
    fireEvent.click(screen.getByText('Remove trainee'));
    expect(await screen.findByText(/still on their laptop \(running\)/)).toBeInTheDocument();
  });

  it('shows why when the server refuses, and keeps the dialog open', async () => {
    const removeTrainee = jest.fn(async () => {
      throw new Error('The repository was not deleted: backstage-main is not named after this trainee\'s lab. Nothing was removed.');
    });
    await setup({ ...worked, agentId: 'a1' }, removeTrainee as any);
    fireEvent.click(screen.getByText('Remove trainee'));
    fireEvent.click(await screen.findByText('Remove and delete repository'));
    expect(await screen.findByText(/Not removed: The repository was not deleted/)).toBeInTheDocument();
    expect(screen.getByText(`Remove ${worked.traineeEmail}?`)).toBeInTheDocument();
  });
});

describe('TraineesPage — lab checks', () => {
  it('runs a check on a running lab and shows the latest result', async () => {
    const runCapstoneCheck = jest.fn(async () => ({ taskId: 't9' }));
    const row: TraineeRow = {
      ...worked,
      traineeEmail: 'tf2@example.com',
      environment: { state: 'running', updatedAt: '2026-10-30T09:00:00Z', agentOnline: true },
      checks: [{ name: 'seeded-resources', status: 'failed', at: '2026-10-30T10:00:00Z', exitCode: 1, output: '{"checked": 12, "missing": ["rds.instance"]}' }],
      capstone: {
        id: 'e3', capstone: 'terraform', traineeNo: '04', status: 'active', seedReportedAt: '2026-10-30T08:00:00Z',
        availableChecks: [{ name: 'seeded-resources', title: 'Seeded prod resources intact (hard fail #1)' }],
      },
    };
    await renderInTestApp(
      <TestApiProvider apis={[[localProvisionerApiRef, { getTrainees: async () => [row], runCapstoneCheck } as any]]}>
        <TraineesPage />
      </TestApiProvider>,
    );
    fireEvent.click(await screen.findByText('tf2@example.com'));
    expect(await screen.findByText('Seeded prod resources intact (hard fail #1)')).toBeInTheDocument();
    expect(screen.getByText(/1 of 12 missing or replaced: rds.instance/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Run'));
    await waitFor(() => expect(runCapstoneCheck).toHaveBeenCalledWith('e3', 'seeded-resources'));
  });

  it('summarises check output', () => {
    expect(checkSummary({ status: 'completed', exitCode: 0, output: 'noise\n{"checked": 9, "missing": []}' })).toBe('all 9 intact');
    expect(checkSummary({ status: 'failed', exitCode: 2, output: 'Traceback…' })).toBe('failed (exit 2)');
    // 2026-10-31: grading failed before the grader ran, and the page said only "failed (exit ?)".
    expect(checkSummary({ status: 'failed', output: "Could not clone the trainee repo with this machine's git login" })).toBe(
      "did not run: Could not clone the trainee repo with this machine's git login",
    );
    expect(checkSummary({ status: 'failed' })).toBe('did not run');
    expect(checkSummary({ status: 'pending' })).toBe('running…');
    expect(checkSummary({ status: 'in-progress' })).toBe('running…');
    expect(
      checkSummary({ status: 'completed', exitCode: 0, output: JSON.stringify({ phase: 'pre', items: [{ points: 15, got: 3 }, { points: 10, got: 0 }], hard_fails: [], auto_total: 3 }) }),
    ).toBe('3/25 automated points (pre) · no hard fails');
    expect(
      checkSummary({ status: 'completed', exitCode: 0, output: JSON.stringify({ phase: 'post', items: [{ points: 5, got: 0 }], hard_fails: ['plaintext secret in git'], auto_total: 0 }) }),
    ).toBe('0/5 automated points (post) · 1 HARD FAIL: plaintext secret in git');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  it.each([
    ['2026-10-30T11:59:30Z', 'just now'],
    ['2026-10-30T11:15:00Z', '45m ago'],
    ['2026-10-30T07:00:00Z', '5h ago'],
    ['2026-10-27T12:00:00Z', '3d ago'],
  ])('%s → %s', (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });
});
