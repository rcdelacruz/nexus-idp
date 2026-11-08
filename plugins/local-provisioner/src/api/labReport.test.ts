import { buildLabReport, parseGrade, reportFileName, reportJson } from './labReport';
import { TraineeRow } from './types';

const grader = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    capstone: 'python-a',
    phase: 'final',
    auto_total: 51.5,
    items: [
      { id: 'A1', area: 'Ingest', title: 'First day loads', points: 4, got: 4, detail: 'ok' },
      { id: 'A2', area: 'Ingest', title: 'Rerun changes nothing', points: 3, got: 1.5, detail: 'one table changed' },
      { id: 'B1', area: 'Privacy', title: 'Phone numbers hashed', points: 5, got: 0, detail: 'not reached' },
    ],
    hard_fails: ['a made-up phone number found in a table'],
    manual: [{ id: 'M1', title: 'Design document', points: 8 }, 'Presentation'],
    notes: ['graded on a fresh seed'],
    ...over,
  });

const row = (over: Partial<TraineeRow> = {}): TraineeRow => ({
  traineeEmail: 'ann.lee@example.com',
  agentId: 'agent-1',
  resourceName: 'python-capstone-a-ann-lee-20261103-1000',
  lab: 'python-capstone-a',
  taskType: 'provision-training',
  environment: { state: 'running', provisionedAt: '2026-11-03T02:00:00Z', updatedAt: '2026-11-03T02:05:00Z', agentOnline: true },
  events: [{ type: 'provision-training', status: 'completed', at: '2026-11-03T02:00:00Z' }],
  repo: {
    owner: 'o', repo: 'r', htmlUrl: 'https://github.com/o/r', empty: false, commitCount: 12,
    lastCommit: { sha: 'abcdef1234567', message: 'feat: ingest', date: '2026-11-04T01:00:00Z', author: 'ann' },
    commitsPerDay: [{ date: '2026-11-03', count: 5 }, { date: '2026-11-04', count: 7 }],
    stageFilesWorked: ['TRIAGE'], aiLogFiles: 3, corrections: 2, decisions: 1,
    progress: { done: 6, total: 10 }, pullRequests: { open: 0, merged: 2 },
    ci: { status: 'completed', conclusion: 'success', updatedAt: '2026-11-04T01:10:00Z', htmlUrl: 'https://github.com/o/r/actions/runs/1' },
  },
  capstone: { id: 'e1', capstone: 'python-a', traineeNo: '07', status: 'active' },
  checks: [{ name: 'grade', status: 'completed', at: '2026-11-05T03:00:00Z', exitCode: 0, output: `starting…\n${grader()}` }],
  ...over,
});

describe('parseGrade', () => {
  it('reads the grader\'s result: items, totals, hard fails, manual items and notes', () => {
    const g = parseGrade(`log line\n${grader()}`)!;
    expect(g.phase).toBe('final');
    expect(g.autoTotal).toBe(51.5);
    expect(g.maxPoints).toBe(12);
    expect(g.items.map(i => i.id)).toEqual(['A1', 'A2', 'B1']);
    expect(g.items[1]).toMatchObject({ area: 'Ingest', title: 'Rerun changes nothing', points: 3, got: 1.5, detail: 'one table changed' });
    expect(g.hardFails).toEqual(['a made-up phone number found in a table']);
    expect(g.manual).toEqual(['Design document (8 points)', 'Presentation']);
    expect(g.notes).toEqual(['graded on a fresh seed']);
  });

  it('is undefined for output that is not a grade', () => {
    for (const bad of [undefined, '', 'no json here', '{"checked":3,"missing":[]}', '{not json', '{"items":"x","auto_total":1}', '{"items":[],"auto_total":"7"}']) {
      expect(parseGrade(bad)).toBeUndefined();
    }
  });

  it('keeps a report readable when the grader writes odd values: caps the lists and truncates long text', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `I${i}`, title: 'x'.repeat(2000), points: 1, got: 1 }));
    const g = parseGrade(grader({ items: many, hard_fails: Array.from({ length: 100 }, () => 'y'.repeat(2000)) }))!;
    expect(g.items).toHaveLength(300);
    expect(g.items[0].title).toHaveLength(300);
    expect(g.hardFails).toHaveLength(50);
    expect(g.hardFails[0]).toHaveLength(500);
  });

  it('tolerates items with missing or non-numeric fields', () => {
    const g = parseGrade(grader({ items: [{ id: 'X', points: 'three', got: null }, null, 'str'] }))!;
    expect(g.items).toEqual([{ id: 'X', area: undefined, title: 'X', points: 0, got: 0, detail: undefined }]);
  });
});

describe('buildLabReport', () => {
  const now = new Date('2026-11-06T00:00:00Z');

  it('turns a capstone row into a report with plain-sentence summary, repo work, grade and history', () => {
    const r = buildLabReport(row(), now);
    expect(r.version).toBe(1);
    expect(r.trainee).toBe('ann.lee@example.com');
    expect(r.course).toBe('python-a');
    expect(r.capstone).toMatchObject({ id: 'e1', traineeNo: '07' });
    expect(r.environment.timeInLab).toBeDefined();
    expect(r.summary.join('\n')).toMatch(/Work: 12 commits, 6 of 10 tasks done, 2 pull requests merged/);
    expect(r.summary.join('\n')).toMatch(/Latest grade: 51.5 of 12 automated points \(final\), 1 hard fail; 2 items left to grade by hand/);
    expect(r.repo).toMatchObject({ commits: 12, commitsLast14Days: 12, lastCommit: expect.objectContaining({ sha: 'abcdef1' }) });
    expect(r.checks[0].grade?.items).toHaveLength(3);
    expect(r.history).toEqual([{ at: '2026-11-03T02:00:00Z', type: 'provision-training', status: 'completed' }]);
    expect(r.generatedAt).toBe(now.toISOString());
  });

  it('never stores the raw check output (only the parsed grade and a one-line summary)', () => {
    const json = JSON.stringify(buildLabReport(row({ checks: [{ name: 'grade', status: 'completed', at: 'x', output: `SECRET-LOG-LINE\n${grader()}` }] }), now));
    expect(json).not.toContain('SECRET-LOG-LINE');
  });

  it('time in the lab runs to the removal when the lab was removed, to now otherwise', () => {
    const removed = buildLabReport(
      row({ events: [{ type: 'provision-training', status: 'completed', at: '2026-11-03T02:00:00Z' }, { type: 'deprovision', status: 'completed', at: '2026-11-03T04:30:00Z' }], environment: { state: 'removed', provisionedAt: '2026-11-03T02:00:00Z', updatedAt: '2026-11-03T04:30:00Z', agentOnline: false } }),
      now,
    );
    expect(removed.environment.timeInLab).toBe('2 h 30 min');
    expect(removed.summary.join('\n')).toMatch(/2 h 30 min from set-up to removal/);
    expect(buildLabReport(row(), now).summary.join('\n')).toMatch(/so far/);
  });

  it('a row with no repository says why, and one with no checks says so', () => {
    const r = buildLabReport(row({ repo: undefined, repoNote: 'Not a GitHub repository (GitLab track)', checks: [], capstone: undefined }), now);
    expect(r.repo).toBeUndefined();
    expect(r.repoNote).toBe('Not a GitHub repository (GitLab track)');
    expect(r.summary.join('\n')).toMatch(/Work: Not a GitHub repository/);
    expect(r.summary.join('\n')).toMatch(/No checks or grades have been run yet/);
    expect(r.course).toBe('python-capstone-a');
  });

  it('a check that is not a grade is summarised in one line', () => {
    const r = buildLabReport(row({ checks: [{ name: 'resources', status: 'completed', at: 'x', exitCode: 0, output: '{"checked":12,"missing":[]}' }] }), now);
    expect(r.checks[0]).toMatchObject({ name: 'resources', summary: 'all 12 intact' });
    expect(r.checks[0].grade).toBeUndefined();
    expect(r.summary.join('\n')).toMatch(/Checks: 1 result, latest: all 12 intact/);
  });
});

describe('file names and data', () => {
  it('a file name has only a-z, 0-9 and hyphens, whatever the lab is called', () => {
    for (const lab of ['python-capstone-a-ann-20261103-1000', '../../etc/passwd', 'A B/C\\D"E', '', '日本語', 'x'.repeat(200)]) {
      const name = reportFileName({ lab, generatedAt: '2026-11-06T00:00:00Z' });
      expect(name).toMatch(/^lab-report-[a-z0-9-]+-2026-11-06$/);
      expect(name.length).toBeLessThan(100);
    }
  });

  it('the data download is valid JSON that reads back to the same report', () => {
    const r = buildLabReport(row(), new Date('2026-11-06T00:00:00Z'));
    expect(JSON.parse(reportJson(r))).toEqual(JSON.parse(JSON.stringify(r)));
  });
});
