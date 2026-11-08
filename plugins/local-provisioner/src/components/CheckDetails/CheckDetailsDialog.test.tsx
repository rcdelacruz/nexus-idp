import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { alertApiRef } from '@backstage/core-plugin-api';
import { CheckDetailsDialog } from './CheckDetailsDialog';
import { TraineeCheck } from '../../api/types';
import { downloadFile } from '../../api/download';

jest.mock('../../api/download', () => ({ downloadFile: jest.fn() }));

const render = async (check: TraineeCheck | null, post = jest.fn()) => {
  const onClose = jest.fn();
  await renderInTestApp(
    <TestApiProvider apis={[[alertApiRef, { post, alert$: () => ({ subscribe: () => ({ unsubscribe() {} }) }) } as any]]}>
      <CheckDetailsDialog check={check} title="Grade (in the trainee lab)" traineeEmail="mia@example.com" onClose={onClose} />
    </TestApiProvider>,
  );
  return { onClose, post };
};

const failedJob: TraineeCheck = {
  name: 'grade',
  status: 'failed',
  at: '2026-11-05T09:30:00Z',
  exitCode: 1,
  error: 'Job exited with 1',
  output: 'Job exited with 1',
  logs: 'Cloning into repo...\nterraform init\nError: Failed to query available provider packages\ndial tcp: lookup registry.terraform.io: no such host',
};

const gradeJson = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    phase: 'post',
    auto_total: 3,
    items: [
      { id: 'a1', area: 'Network', title: 'Subnets per zone', points: 4, got: 4 },
      { id: 'a2', area: 'Data', title: 'Bucket is private', points: 3, got: 1, detail: 'Public ACL found on exports bucket' },
      { id: 'a3', area: 'Data', title: 'Lifecycle rule', points: 2, got: 0, detail: 'No lifecycle rule' },
    ],
    hard_fails: ['Secret committed to git'],
    manual: [{ title: 'Architecture write-up', points: 10 }],
    notes: ['Grader ran against capstone-final'],
    ...extra,
  });

describe('CheckDetailsDialog — a grade job that failed', () => {
  it('shows the agent reason, the exit code and the end of the job log', async () => {
    await render(failedJob);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Grade (in the trainee lab)')).toBeInTheDocument();
    expect(within(dialog).getByText('mia@example.com')).toBeInTheDocument();
    expect(within(dialog).getByText('failed (exit 1)')).toBeInTheDocument();
    expect(within(dialog).getByText('Exit code').nextSibling).toHaveTextContent('1');
    expect(within(dialog).getByText('What the agent reported')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Job exited with 1').length).toBeGreaterThan(0);
    const log = within(dialog).getByTestId('check-log');
    expect(log).toHaveTextContent('dial tcp: lookup registry.terraform.io: no such host');
    expect(log).toHaveTextContent('Error: Failed to query available provider packages');
    // The log is shown once; a failed check does not also repeat its reason in an "Output" box.
    expect(within(dialog).queryByTestId('check-output')).not.toBeInTheDocument();
  });

  it('uses the output as the reason when the agent sent no error text, and says so when it sent neither', async () => {
    const { onClose } = await render({ name: 'grade', status: 'failed', at: '2026-11-05T09:30:00Z', output: 'Could not clone the trainee repo' });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText('Could not clone the trainee repo').length).toBeGreaterThan(0);
    expect(within(dialog).queryByText('No reason was reported.')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says no reason was reported when the agent sent neither an error nor output', async () => {
    await render({ name: 'grade', status: 'failed', at: '2026-11-05T09:30:00Z' });
    expect(await screen.findByText('No reason was reported.')).toBeInTheDocument();
  });

  it('shows the log as text, never as markup', async () => {
    await render({ ...failedJob, logs: '<img src=x onerror=alert(1)><script>alert(2)</script> & done' });
    const log = await screen.findByTestId('check-log');
    expect(log.querySelector('img')).toBeNull();
    expect(log.querySelector('script')).toBeNull();
    expect(log).toHaveTextContent('<img src=x onerror=alert(1)><script>alert(2)</script> & done');
  });

  it('says plainly when the agent sent no log, and offers no copy or download', async () => {
    await render({ ...failedJob, logs: undefined });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/The agent sent no log for this result, only the reason above/)).toBeInTheDocument();
    expect(within(dialog).queryByTestId('check-log')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Copy log')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Download log (.txt)')).not.toBeInTheDocument();
  });

  it('a blank log counts as no log', async () => {
    await render({ ...failedJob, logs: '  \n ' });
    expect(await screen.findByText(/The agent sent no log/)).toBeInTheDocument();
  });

  it('a failure with no exit code (the job never started) shows its reason, not an exit code', async () => {
    await render({ name: 'grade', status: 'failed', at: '2026-11-05T09:30:00Z', error: 'Lab service app is not running', output: 'Lab service app is not running' });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Exit code')).not.toBeInTheDocument();
    expect(within(dialog).getByText('did not run: Lab service app is not running')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Lab service app is not running').length).toBeGreaterThan(0);
  });

  it('copies the log, and says so', async () => {
    const writeText = jest.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { post } = await render(failedJob);
    fireEvent.click(await screen.findByText('Copy log'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(failedJob.logs));
    await waitFor(() => expect(post).toHaveBeenCalledWith({ message: 'Log copied', severity: 'success', display: 'transient' }));
  });

  it('says so when the browser refuses the copy', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn(async () => {
          throw new Error('denied');
        }),
      },
    });
    const { post } = await render(failedJob);
    fireEvent.click(await screen.findByText('Copy log'));
    await waitFor(() => expect(post).toHaveBeenCalledWith({ message: 'Could not copy: select the text and copy it by hand', severity: 'error' }));
  });

  it('downloads the log as a text file named after the check and the day', async () => {
    await render(failedJob);
    fireEvent.click(await screen.findByText('Download log (.txt)'));
    expect(downloadFile).toHaveBeenCalledWith('check-log-grade-2026-11-05.txt', 'text/plain', failedJob.logs);
  });

  it('Close closes it', async () => {
    const { onClose } = await render(failedJob);
    fireEvent.click(await screen.findByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('CheckDetailsDialog — a grade that ran', () => {
  const graded: TraineeCheck = { name: 'grade', status: 'completed', at: '2026-11-05T09:30:00Z', exitCode: 0, output: `building...\n${gradeJson()}` };

  it('shows the score, the hard fails and only the items that lost points, with why', async () => {
    await render(graded);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Score: 3 of 9 automated points (post)')).toBeInTheDocument();
    expect(within(dialog).getByText('Secret committed to git')).toBeInTheDocument();
    const rows = within(dialog).getAllByRole('row').map(r => r.textContent);
    expect(rows.some(r => r?.includes('Bucket is private') && r.includes('1 / 3') && r.includes('Public ACL found on exports bucket'))).toBe(true);
    expect(rows.some(r => r?.includes('Lifecycle rule') && r.includes('0 / 2') && r.includes('No lifecycle rule'))).toBe(true);
    expect(within(dialog).queryByText('Subnets per zone')).not.toBeInTheDocument(); // full marks: not listed
    expect(within(dialog).getByText('Architecture write-up (10 points)')).toBeInTheDocument();
    expect(within(dialog).getByText('Grader ran against capstone-final')).toBeInTheDocument();
    expect(within(dialog).queryByText('Copy log')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('What the agent reported')).not.toBeInTheDocument();
  });

  it('says so when every item scored full points and there is nothing to fix', async () => {
    const full = JSON.stringify({ auto_total: 4, items: [{ id: 'a1', title: 'One', points: 4, got: 4 }], hard_fails: [] });
    await render({ ...graded, output: full });
    expect(await screen.findByText('Every automated item scored full points.')).toBeInTheDocument();
    expect(screen.queryByText('Hard fails')).not.toBeInTheDocument();
  });

  it('item text from the grader is shown as text', async () => {
    const evil = JSON.stringify({ auto_total: 0, items: [{ id: 'x', title: '<b>bold</b>', points: 1, got: 0, detail: '<script>alert(1)</script>' }], hard_fails: [] });
    await render({ ...graded, output: evil });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('<b>bold</b>')).toBeInTheDocument();
    expect(dialog.querySelector('script')).toBeNull();
    expect(dialog.querySelector('b')).toBeNull();
  });
});

describe('CheckDetailsDialog — other checks and nothing selected', () => {
  it('a finished check that is not a grade shows what it printed', async () => {
    await render({ name: 'seeded-resources', status: 'completed', at: '2026-11-05T09:30:00Z', exitCode: 0, output: '{"checked":12,"missing":[]}' });
    expect(await screen.findByTestId('check-output')).toHaveTextContent('{"checked":12,"missing":[]}');
    expect(screen.getByText('all 12 intact')).toBeInTheDocument();
  });

  it('renders nothing when no check is selected', async () => {
    await render(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
