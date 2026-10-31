import {
  commitsPerDay,
  countCorrections,
  countDecisions,
  countProgress,
  diffWorkTree,
  parseGithubRepoUrl,
} from './parsers';

describe('trainee activity parsers', () => {
  it('counts CORRECTIONS.md entries, ignoring the empty template placeholder', () => {
    const template = '# Corrections log\n\nEvery time the agent proposed something wrong...\n\n1.\n';
    expect(countCorrections(template)).toBe(0);
    expect(
      countCorrections(`${template}1. Agent ran migrate reset → would wipe prod → used generate\n2. Added await → still racy → updateMany\n`),
    ).toBe(2);
  });

  it('counts DECISIONS.md ADRs, ignoring the <title> placeholder', () => {
    expect(countDecisions('# Decisions\n\n## D-01: <title>\n\n- **Context:**\n')).toBe(0);
    expect(countDecisions('## D-01: Hashing library\n...\n## D-02: Token strategy\n## D-03: <title>\n')).toBe(2);
  });

  it('counts PROGRESS.md checkboxes', () => {
    expect(countProgress('- [x] MS-01 one\n- [ ] MS-02 two\n* [X] MS-03 three\nnot a task\n')).toEqual({ done: 2, total: 3 });
    expect(countProgress('')).toEqual({ done: 0, total: 0 });
  });

  it('finds stage files changed since the first commit and counts AI transcripts', () => {
    const initial = [
      { path: 'TRIAGE.md', type: 'blob', sha: 'a' },
      { path: 'CORRECTIONS.md', type: 'blob', sha: 'b' },
      { path: 'ai-log/.gitkeep', type: 'blob', sha: 'k' },
      { path: 'src/app.ts', type: 'blob', sha: 's' },
    ];
    const head = [
      { path: 'TRIAGE.md', type: 'blob', sha: 'a' }, // untouched
      { path: 'CORRECTIONS.md', type: 'blob', sha: 'b2' }, // edited
      { path: 'DECISIONS.md', type: 'blob', sha: 'd' }, // added
      { path: 'docs/RUNBOOK.md', type: 'blob', sha: 'r' }, // not at the root: ignored
      { path: 'ai-log/.gitkeep', type: 'blob', sha: 'k' },
      { path: 'ai-log/day1.md', type: 'blob', sha: 'x' },
      { path: 'ai-log/day2.md', type: 'blob', sha: 'y' },
      { path: 'ai-log', type: 'tree', sha: 't' },
      { path: 'src/app.ts', type: 'blob', sha: 's2' }, // not a stage file
    ];
    expect(diffWorkTree(initial, head)).toEqual({ stageFilesWorked: ['CORRECTIONS', 'DECISIONS'], aiLogFiles: 2 });
  });

  it('parses only github.com repo URLs', () => {
    expect(parseGithubRepoUrl('https://github.com/stratpoint-engineering/training-x-1')).toEqual({
      owner: 'stratpoint-engineering',
      repo: 'training-x-1',
    });
    expect(parseGithubRepoUrl('https://github.com/org/repo.git')).toEqual({ owner: 'org', repo: 'repo' });
    expect(parseGithubRepoUrl('https://gitlab.example.com/a/b')).toBeUndefined();
    expect(parseGithubRepoUrl('https://github.com/org')).toBeUndefined();
    expect(parseGithubRepoUrl(undefined)).toBeUndefined();
  });

  it('buckets commits per UTC day, oldest first', () => {
    const now = new Date('2026-10-30T12:00:00Z');
    const series = commitsPerDay(['2026-10-30T01:00:00Z', '2026-10-30T09:00:00Z', '2026-10-28T23:59:00Z', '2026-09-01T00:00:00Z'], now, 3);
    expect(series).toEqual([
      { date: '2026-10-28', count: 1 },
      { date: '2026-10-29', count: 0 },
      { date: '2026-10-30', count: 2 },
    ]);
  });
});
