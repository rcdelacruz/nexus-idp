import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { buildLabReport, LabReport } from '../../api/labReport';
import { TraineeRow } from '../../api/types';
import { LabReportView, reportHtmlDocument } from './LabReportView';
import { LabReportDialog } from './LabReportDialog';
import { downloadFile } from '../../api/download';

jest.mock('../../api/download', () => ({ downloadFile: jest.fn() }));

const grade = JSON.stringify({
  phase: 'final',
  auto_total: 5,
  items: [{ id: 'A1', area: 'Ingest', title: 'First day loads', points: 4, got: 4, detail: 'ok' }, { id: 'B1', area: 'Privacy', title: 'Hashed', points: 3, got: 1, detail: 'partly' }],
  hard_fails: ['phone number found'],
  manual: ['Design document'],
  notes: ['graded on a fresh seed'],
});
const base: TraineeRow = {
  traineeEmail: 'ann.lee@example.com',
  resourceName: 'python-capstone-a-ann-lee-20261103-1000',
  lab: 'python-capstone-a',
  taskType: 'provision-training',
  environment: { state: 'running', provisionedAt: '2026-11-03T02:00:00Z', updatedAt: '2026-11-03T02:05:00Z', agentOnline: true },
  events: [{ type: 'provision-training', status: 'completed', at: '2026-11-03T02:00:00Z' }],
  checks: [{ name: 'grade', status: 'completed', at: '2026-11-05T03:00:00Z', exitCode: 0, output: grade }],
};
const make = (over: Partial<TraineeRow> = {}): LabReport => buildLabReport({ ...base, ...over }, new Date('2026-11-06T00:00:00Z'));

describe('LabReportView', () => {
  it('shows the summary, the details, the grade table with its totals, hard fails, hand-graded items and notes', () => {
    render(<LabReportView report={make()} />);
    expect(screen.getByText('Lab report')).toBeInTheDocument();
    expect(screen.getByText(/Latest grade: 5 of 7 automated points \(final\), 1 hard fail/)).toBeInTheDocument();
    expect(screen.getByText('First day loads')).toBeInTheDocument();
    expect(screen.getByText('Hashed')).toBeInTheDocument();
    expect(screen.getByText('Automated total')).toBeInTheDocument();
    expect(screen.getByText('phone number found')).toHaveClass('lr-bad');
    expect(screen.getByText('Design document')).toBeInTheDocument();
    expect(screen.getByText('graded on a fresh seed')).toBeInTheDocument();
    expect(screen.getByText('Environment history')).toBeInTheDocument();
  });

  it('says what is missing instead of leaving a blank section', () => {
    render(<LabReportView report={make({ checks: [], repoNote: 'No repository' })} />);
    expect(screen.getByText('No checks or grades have been run yet.', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('No repository', { selector: 'p' })).toBeInTheDocument();
  });
});

describe('the standalone page', () => {
  const hostile = (s: string) => make({
    traineeEmail: `x${s}@example.com`,
    resourceName: `lab${s}`,
    repoNote: undefined,
    repo: {
      owner: 'o', repo: 'r', htmlUrl: `https://github.com/o/r${s}`, empty: false, commitCount: 1,
      lastCommit: { sha: 'abcdef1', message: s, date: '2026-11-04T01:00:00Z', author: s },
      commitsPerDay: [], stageFilesWorked: [s], aiLogFiles: 0, corrections: 0, decisions: 0, pullRequests: { open: 0, merged: 0 },
    },
    checks: [{
      name: s, status: 'completed', at: '2026-11-05T03:00:00Z', exitCode: 0,
      output: JSON.stringify({ phase: s, auto_total: 1, items: [{ id: 'A', title: s, points: 1, got: 1, detail: s }], hard_fails: [s], manual: [s], notes: [s] }),
    }],
  });

  it('is a complete document with its own style, ready to save, email or print', () => {
    const html = reportHtmlDocument(make());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<style>');
    expect(html).toContain('<title>Lab report - ann.lee@example.com - python-capstone-a-ann-lee-20261103-1000</title>');
    expect(html).toContain('First day loads');
  });

  it.each([
    ['a script tag', '<script>alert(1)</script>'],
    ['an image with a handler', '<img src=x onerror=alert(1)>'],
    ['a closing title tag', '</title><script>alert(1)</script>'],
    ['an attribute breaker', '"><svg onload=alert(1)>'],
    ['an iframe', '<iframe src="javascript:alert(1)"></iframe>'],
  ])('text written by a trainee can never become markup: %s', (_label, payload) => {
    const html = reportHtmlDocument(hostile(payload));
    // The only tags in the document are the report's own; none of the payload's tags is one of them.
    expect(html.toLowerCase()).not.toMatch(/<script/);
    expect(html.toLowerCase()).not.toMatch(/<img/);
    expect(html.toLowerCase()).not.toMatch(/<svg/);
    expect(html.toLowerCase()).not.toMatch(/<iframe/);
    expect(html.toLowerCase().match(/<\/title>/g)).toHaveLength(1);
    expect(html).toContain('&lt;');
    // and the on-screen view shows the same text as text
    const { container } = render(<LabReportView report={hostile(payload)} />);
    expect(container.querySelector('script, img, svg, iframe')).toBeNull();
  });
});

describe('LabReportDialog', () => {
  const save = downloadFile as jest.Mock;
  beforeEach(() => save.mockClear());

  it('shows nothing without a report', () => {
    render(<LabReportDialog report={null} onClose={() => {}} />);
    expect(screen.queryByText('Lab report')).not.toBeInTheDocument();
  });

  it('offers the standalone page and the data, each saved under a safe name, and closes', () => {
    const onClose = jest.fn();
    const report = make();
    render(<LabReportDialog report={report} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /Download report \(\.html\)/ }));
    expect(save).toHaveBeenLastCalledWith('lab-report-python-capstone-a-ann-lee-20261103-1000-2026-11-06.html', 'text/html', expect.stringContaining('<!doctype html>'));

    fireEvent.click(screen.getByRole('button', { name: /Download data \(\.json\)/ }));
    const [name, mime, content] = save.mock.calls[1];
    expect(name).toBe('lab-report-python-capstone-a-ann-lee-20261103-1000-2026-11-06.json');
    expect(mime).toBe('application/json');
    expect(JSON.parse(content).trainee).toBe('ann.lee@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
