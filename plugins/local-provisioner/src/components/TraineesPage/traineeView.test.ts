import type { TraineeActivityItem, TraineeListRow } from '../../api/types';
import {
  activityAttention,
  attentionOf,
  canHaveActivity,
  ciRank,
  combineAttention,
  commitsLast14Days,
  compareAttention,
  compareBy,
  compareLab,
  compareName,
  courseOf,
  DEFAULT_VIEW,
  idleDays,
  isCiFailing,
  lastCommitAt,
  matchesSearch,
  parseView,
  prettyCourse,
  progressRatio,
  viewToParams,
} from './traineeView';

const NOW = Date.parse('2026-11-07T12:00:00Z');
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const row = (name: string, over: Partial<TraineeListRow> = {}): TraineeListRow => ({
  key: `lab:agent-${name}::${name}`,
  traineeEmail: `${name}@example.com`,
  agentId: `agent-${name}`,
  resourceName: name,
  lab: 'terraform-capstone-a',
  taskType: 'provision-training',
  environment: { state: 'running', updatedAt: iso(10 * DAY), provisionedAt: iso(20 * DAY), agentOnline: true },
  repoUrl: `https://github.com/o/${name}`,
  hasGithubRepo: true,
  ...over,
});
const item = (r: TraineeListRow, repo: Record<string, unknown> | undefined, code: TraineeActivityItem['code'] = 'ok'): TraineeActivityItem => ({
  key: r.key,
  repoUrl: r.repoUrl,
  fetchedAt: iso(0),
  code,
  repo: repo as any,
});
const lookupOf = (items: TraineeActivityItem[]) => (r: TraineeListRow) => items.find(i => i.key === r.key);
const brief = (over: Record<string, unknown> = {}) => ({ owner: 'o', repo: 'r', htmlUrl: 'x', empty: false, commitsPerDay: [], lastCommit: { sha: 'a', message: 'm', date: iso(DAY), author: 'x' }, ...over });

describe('the view in the address', () => {
  const parse = (query: string) => parseView(new URLSearchParams(query));

  it('the plain page has a plain address, and a plain address is the default view', () => {
    expect(viewToParams(DEFAULT_VIEW).toString()).toBe('');
    expect(parse('')).toEqual(DEFAULT_VIEW);
  });

  it('round-trips the tab and the open trainee (search, order and page are the table\'s own)', () => {
    const view = { tab: 'archive', open: 'lab:agent-1::my-lab' } as const;
    const params = viewToParams(view);
    expect(parse(params.toString())).toEqual(view);
    expect(params.get('open')).toBe('lab:agent-1::my-lab');
    expect(viewToParams({ tab: 'active', open: 'cap:7' }).toString()).toBe('open=cap%3A7');
  });

  it('an unknown tab falls back to Active', () => {
    expect(parse('tab=everything').tab).toBe('active');
    expect(parse('tab=archive').tab).toBe('archive');
  });

  it('caps the length of the open key, so an address cannot carry a book', () => {
    expect(parse(`open=${'y'.repeat(900)}`).open).toHaveLength(400);
  });

  it('an empty open is no panel', () => {
    expect(parse('open=').open).toBeUndefined();
  });
});

describe('courses', () => {
  it('a capstone is named by its capstone, a plain lab by its lab id', () => {
    expect(courseOf(row('a'))).toBe('terraform-capstone-a');
    expect(courseOf(row('b', { capstone: { id: 'e', capstone: 'nodejs-b', traineeNo: '01', status: 'active' } }))).toBe('nodejs-b');
    expect(courseOf(row('c', { lab: undefined }))).toBe('');
  });

  it('is shown as words', () => {
    expect(prettyCourse('terraform-capstone-a')).toBe('Terraform capstone A');
    expect(prettyCourse('nodejs-b')).toBe('Nodejs B');
    expect(prettyCourse('')).toBe('—');
  });
});

describe('attention from GitHub data', () => {
  it('CI failing is serious; a conclusion that is not a failure is not', () => {
    const r = row('a');
    for (const conclusion of ['failure', 'timed_out', 'startup_failure', 'cancelled', 'action_required']) {
      expect(isCiFailing(item(r, brief({ ci: { status: 'completed', conclusion, updatedAt: '', htmlUrl: '' } })))).toBe(true);
    }
    for (const conclusion of ['success', 'skipped', 'neutral', null]) {
      expect(isCiFailing(item(r, brief({ ci: { status: 'completed', conclusion, updatedAt: '', htmlUrl: '' } })))).toBe(false);
    }
    expect(isCiFailing(item(r, brief({ ci: { status: 'in_progress', conclusion: null, updatedAt: '', htmlUrl: '' } })))).toBe(false);
    expect(isCiFailing(item(r, brief()))).toBe(false);
    expect(isCiFailing(undefined)).toBe(false);
    expect(isCiFailing(item(r, undefined, 'unavailable'))).toBe(false);
  });

  it('no commits for three days or more is a warning, counted in whole days', () => {
    const r = row('a');
    const idle = (msAgo: number) => idleDays(r, item(r, brief({ lastCommit: { sha: 'a', message: 'm', date: iso(msAgo), author: 'x' } })), NOW);
    expect(idle(3 * DAY - 60_000)).toBeUndefined();
    expect(idle(3 * DAY)).toBe(3);
    expect(idle(10 * DAY + 3_600_000)).toBe(10);
    expect(activityAttention(r, item(r, brief({ lastCommit: { sha: 'a', message: 'm', date: iso(5 * DAY), author: 'x' } })), NOW)).toEqual({ severity: 1, code: 'idle', text: 'No commits for 5 d' });
  });

  it('a repository with no commits counts from when the lab was set up', () => {
    const r = row('a');
    expect(idleDays(r, item(r, brief({ lastCommit: undefined, empty: true })), NOW)).toBe(20);
    const fresh = row('b', { environment: { state: 'running', updatedAt: iso(0), provisionedAt: iso(DAY), agentOnline: true } });
    expect(idleDays(fresh, item(fresh, brief({ lastCommit: undefined, empty: true })), NOW)).toBeUndefined();
  });

  it('says nothing without loaded data, for a failed read, or for a capstone with no environment', () => {
    const r = row('a');
    expect(activityAttention(r, undefined, NOW)).toBeUndefined();
    expect(activityAttention(r, item(r, undefined, 'unavailable'), NOW)).toBeUndefined();
    expect(activityAttention(r, item(r, undefined, 'rate_limited'), NOW)).toBeUndefined();
    const cap = row('c', { environment: { state: 'none', updatedAt: iso(0), agentOnline: false } });
    expect(idleDays(cap, item(cap, brief({ lastCommit: { sha: 'a', message: 'm', date: iso(30 * DAY), author: 'x' } })), NOW)).toBeUndefined();
  });

  it('CI failing outranks idle', () => {
    const r = row('a');
    const both = item(r, brief({ lastCommit: { sha: 'a', message: 'm', date: iso(9 * DAY), author: 'x' }, ci: { status: 'completed', conclusion: 'failure', updatedAt: '', htmlUrl: '' } }));
    expect(activityAttention(r, both, NOW)?.code).toBe('ci_failing');
  });

  it('the more serious reason wins, and the database wins a tie', () => {
    const db = { severity: 1 as const, code: 'stuck', text: 'Stuck for 50 min' };
    const gh = { severity: 1 as const, code: 'idle', text: 'No commits for 4 d' };
    const ci = { severity: 2 as const, code: 'ci_failing', text: 'CI failing' };
    expect(combineAttention(db, gh)).toBe(db);
    expect(combineAttention(db, ci)).toBe(ci);
    expect(combineAttention({ ...db, severity: 2 }, gh)).toMatchObject({ code: 'stuck' });
    expect(combineAttention(undefined, gh)).toBe(gh);
    expect(combineAttention(db, undefined)).toBe(db);
    expect(combineAttention(undefined, undefined)).toBeUndefined();
  });

  it('attentionOf combines the row’s database reason with its GitHub data', () => {
    const r = row('a', { attention: { severity: 1, code: 'agent_offline', text: 'Agent offline for 2 d' } });
    const failing = item(r, brief({ ci: { status: 'completed', conclusion: 'failure', updatedAt: '', htmlUrl: '' } }));
    expect(attentionOf(r, failing, NOW)?.code).toBe('ci_failing');
    expect(attentionOf(r, undefined, NOW)?.code).toBe('agent_offline');
  });
});

describe('search', () => {
  const rows = [
    row('ann', { lab: 'terraform-capstone-a' }),
    row('bob', { lab: 'nodejs-capstone-a' }),
    row('cy', { lab: 'terraform-capstone-a' }),
  ];

  it('looks at the trainee, the lab and the course, in any letter case', () => {
    const q = (text: string) => rows.filter(r => matchesSearch(r, text)).map(r => r.resourceName);
    expect(q('ANN')).toEqual(['ann']);
    expect(q('nodejs')).toEqual(['bob']);
    expect(q('Terraform capstone')).toEqual(['ann', 'cy']);
    expect(q('example.com')).toEqual(['ann', 'bob', 'cy']);
    expect(q('  ')).toHaveLength(3);
    expect(q('nobody')).toEqual([]);
  });

  it('a row with no GitHub repository, or an archived one, is not waited for', () => {
    const noRepo = row('n', { hasGithubRepo: false });
    const archived = row('z', { capstone: { id: 'e', capstone: 'x', traineeNo: '01', status: 'completed' } });
    expect(canHaveActivity(noRepo)).toBe(false);
    expect(canHaveActivity(archived)).toBe(false);
    expect(canHaveActivity(row('ok'))).toBe(true);
  });
});

describe('ordering: every column has one', () => {
  const a = row('a', { attention: { severity: 1, code: 'stuck', text: 's' }, environment: { state: 'running', updatedAt: iso(5 * DAY), agentOnline: true } });
  const b = row('b', { attention: { severity: 2, code: 'lab_failed', text: 'f' }, environment: { state: 'error', updatedAt: iso(9 * DAY), agentOnline: true } });
  const c = row('c', { environment: { state: 'stopped', updatedAt: iso(1 * DAY), agentOnline: true } });
  const d = row('d', { environment: { state: 'running', updatedAt: iso(1 * DAY), agentOnline: true } });
  const names = (list: TraineeListRow[]) => list.map(r => r.resourceName);
  /** What the table does: "asc" sorts with (a, b); "desc" sorts with (b, a) and says "desc". */
  const asc = (list: TraineeListRow[], cmp: (x: TraineeListRow, y: TraineeListRow, t?: string, dir?: string) => number) => [...list].sort((x, y) => cmp(x, y, 'row'));
  const desc = (list: TraineeListRow[], cmp: (x: TraineeListRow, y: TraineeListRow, t?: string, dir?: string) => number) => [...list].sort((x, y) => cmp(y, x, 'row', 'desc'));

  it('attention: most serious first, then the most recent change, then the key (the server\'s order)', () => {
    expect(names(asc([d, c, a, b], compareAttention))).toEqual(['b', 'a', 'c', 'd']);
    expect(names(desc([d, c, a, b], compareAttention))).toEqual(['d', 'c', 'a', 'b']);
  });

  it('the attention order does not depend on GitHub data (so rows do not move as it arrives)', () => {
    const before = names(asc([d, c, a, b], compareAttention));
    // compareAttention takes rows only: there is no way for loaded data to enter it.
    expect(compareAttention.length).toBe(2);
    expect(names(asc([b, d, a, c], compareAttention))).toEqual(before);
  });

  it('trainee: by e-mail', () => {
    expect(names(asc([d, b, c, a], compareName))).toEqual(['a', 'b', 'c', 'd']);
    expect(names(desc([d, b, c, a], compareName))).toEqual(['d', 'c', 'b', 'a']);
  });

  it('lab: failed first, then setting up, running, stopped, no environment', () => {
    const p = row('p', { environment: { state: 'provisioning', updatedAt: iso(DAY), agentOnline: true } });
    const n = row('n', { environment: { state: 'none', updatedAt: iso(DAY), agentOnline: true } });
    expect(names(asc([n, c, d, p, b], compareLab))).toEqual(['b', 'p', 'd', 'c', 'n']);
  });

  const lookupOf2 = (pairs: Array<[TraineeListRow, Record<string, unknown> | undefined, TraineeActivityItem['code']?]>) => {
    const m = new Map(pairs.map(([r, repo, code]) => [r.key, item(r, repo, code ?? 'ok')]));
    return (r: TraineeListRow) => m.get(r.key);
  };

  it('progress: the furthest behind first; rows with no data last, in either direction', () => {
    const lookup = lookupOf2([[a, brief({ progress: { done: 8, total: 10 } })], [b, brief({ progress: { done: 2, total: 10 } })], [c, brief({ progress: { done: 0, total: 0 } })]]);
    const cmp = compareBy(r => progressRatio(lookup(r)));
    expect(names(asc([a, b, c, d], cmp))).toEqual(['b', 'a', 'c', 'd']);
    expect(names(desc([a, b, c, d], cmp))).toEqual(['a', 'b', 'c', 'd']); // c has a zero total (no value) and d has no data: both last
  });

  it('rows with no value go last in either direction, whatever order they arrive in', () => {
    const m1 = row('m1', { environment: { state: 'running', updatedAt: iso(2 * DAY), agentOnline: true } });
    const m2 = row('m2', { environment: { state: 'running', updatedAt: iso(3 * DAY), agentOnline: true } });
    const lookup = lookupOf2([[a, brief({ progress: { done: 8, total: 10 } })], [b, brief({ progress: { done: 2, total: 10 } })]]);
    const cmp = compareBy(r => progressRatio(lookup(r)));
    const permutations = <T,>(list: T[]): T[][] => (list.length <= 1 ? [list] : list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map(rest => [x, ...rest])));
    for (const input of permutations([a, b, m1, m2])) {
      expect(names(asc(input, cmp))).toEqual(['b', 'a', 'm1', 'm2']); // missing ones keep the attention order among themselves
      expect(names(desc(input, cmp))).toEqual(['a', 'b', 'm1', 'm2']);
    }
  });

  it('last commit: the oldest first; rows with no data last', () => {
    const at = (days: number) => brief({ lastCommit: { sha: 'a', message: 'm', date: iso(days * DAY), author: 'x' } });
    const lookup = lookupOf2([[a, at(3)], [b, at(1)], [c, undefined, 'unavailable']]);
    const cmp = compareBy(r => lastCommitAt(lookup(r)));
    expect(names(asc([a, b, c, d], cmp))).toEqual(['a', 'b', 'c', 'd']);
    expect(names(desc([a, b, c, d], cmp))).toEqual(['b', 'a', 'c', 'd']);
  });

  it('14 days: the fewest commits first', () => {
    const days = (counts: number[]) => brief({ commitsPerDay: counts.map((count, i) => ({ date: `2026-11-0${i + 1}`, count })) });
    const lookup = lookupOf2([[a, days([0, 5, 1])], [b, days([0, 0, 0])], [c, days([2, 0, 0])]]);
    expect(commitsLast14Days(lookup(a))).toBe(6);
    const cmp = compareBy(r => commitsLast14Days(lookup(r)));
    expect(names(asc([a, b, c, d], cmp))).toEqual(['b', 'c', 'a', 'd']);
  });

  it('CI: failing first, then running, then passing; no run last', () => {
    const ci = (status: string, conclusion?: string) => brief({ ci: { status, conclusion, updatedAt: '', htmlUrl: '' } });
    const lookup = lookupOf2([[a, ci('completed', 'success')], [b, ci('completed', 'failure')], [c, ci('in_progress')], [d, brief()]]);
    expect(ciRank(lookup(b))).toBe(0);
    const cmp = compareBy(r => ciRank(lookup(r)));
    expect(names(asc([a, b, c, d], cmp))).toEqual(['b', 'c', 'a', 'd']);
  });

  it('a tie falls back to the attention order, and nothing is changed in the list it is given', () => {
    const input = [d, c, a, b];
    const cmp = compareBy(() => 1);
    expect(names(asc(input, cmp))).toEqual(['b', 'a', 'c', 'd']);
    expect(names(input)).toEqual(['d', 'c', 'a', 'b']);
  });
});
