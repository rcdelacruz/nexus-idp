import { databaseAttention, OFFLINE_AFTER_MS, parseGradeOutcome, STUCK_AFTER_MS } from './traineeAttention';

const NOW = new Date('2026-11-07T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const base = { state: 'running', isNewestLab: true, agentOnline: true, now: NOW };

/** Last lines of the three graders, in the shape each prints (`{phase, auto_total, items[], hard_fails[], manual, notes}`). */
const graderLine = (hardFails: string[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ phase: 'pre', auto_total: 41, items: [{ id: 'net', area: 'Network', title: 'Subnets', points: 5, got: 5 }], hard_fails: hardFails, manual: [{ title: 'Write-up', points: 10 }], notes: ['n'], ...extra });

describe('parseGradeOutcome', () => {
  it('counts the hard fails of a grade, whatever was printed before it', () => {
    expect(parseGradeOutcome(`building...\nterraform init ok\n${graderLine(['Secret committed to git', 'tfstate committed'])}`)).toEqual({ hardFails: 2 });
    expect(parseGradeOutcome(graderLine([]))).toEqual({ hardFails: 0 });
    expect(parseGradeOutcome(`${graderLine(['x'])}\n`)).toEqual({ hardFails: 1 });
  });

  it('a grade without a hard_fails list has none', () => {
    expect(parseGradeOutcome(JSON.stringify({ auto_total: 3, items: [] }))).toEqual({ hardFails: 0 });
    expect(parseGradeOutcome(JSON.stringify({ auto_total: 3, items: [], hard_fails: 'oops' }))).toEqual({ hardFails: 0 });
  });

  it('is not fooled by output that is not a grade', () => {
    for (const out of [undefined, '', 'Job exited with 1', '{"checked":12,"missing":["s3.exports"]}', '{not json', '{"items":[]}', '{"auto_total":3}', '[1,2]', 'null', '{"auto_total":"3","items":[]}', '{"auto_total":3,"items":{}}']) {
      expect(parseGradeOutcome(out)).toBeUndefined();
    }
  });

  it('only the last JSON line counts', () => {
    expect(parseGradeOutcome(`${graderLine(['old'])}\n${graderLine([])}`)).toEqual({ hardFails: 0 });
    expect(parseGradeOutcome(`${graderLine(['x'])}\n{"checked":1,"missing":[]}`)).toBeUndefined();
  });
});

describe('databaseAttention', () => {
  it('says nothing about a healthy lab', () => {
    expect(databaseAttention({ ...base })).toBeUndefined();
    expect(databaseAttention({ ...base, state: 'stopped', agentOnline: false, agentLastSeen: ago(100 * 3_600_000) })).toBeUndefined();
    expect(databaseAttention({ ...base, state: 'none' })).toBeUndefined();
  });

  it('a failed lab is serious, but only the trainee’s newest lab of the course', () => {
    expect(databaseAttention({ ...base, state: 'error' })).toEqual({ severity: 2, code: 'lab_failed', text: 'Lab failed' });
    expect(databaseAttention({ ...base, state: 'error', isNewestLab: false })).toBeUndefined();
  });

  it('a hard fail in the newest finished grade is serious; no hard fail, an unreadable output or a running grade is not', () => {
    const grade = (status: string, output?: string) => databaseAttention({ ...base, newestGrade: { status, output } });
    expect(grade('completed', graderLine(['x']))).toEqual({ severity: 2, code: 'hard_fail', text: 'Hard fail in last grade' });
    expect(grade('completed', graderLine([]))).toBeUndefined();
    expect(grade('completed', 'garbage')).toBeUndefined();
    expect(grade('completed', undefined)).toBeUndefined();
    expect(grade('in-progress', graderLine(['x']))).toBeUndefined();
    expect(grade('pending', undefined)).toBeUndefined();
  });

  it('a grade that did not finish is a warning', () => {
    expect(databaseAttention({ ...base, newestGrade: { status: 'failed', output: 'Job exited with 1' } })).toEqual({ severity: 1, code: 'grade_unfinished', text: 'Last grade did not finish' });
  });

  it('a task running for more than 45 minutes is stuck; 45 minutes exactly is not yet', () => {
    expect(databaseAttention({ ...base, state: 'provisioning', current: { since: ago(STUCK_AFTER_MS) } })).toBeUndefined();
    expect(databaseAttention({ ...base, state: 'provisioning', current: { since: ago(STUCK_AFTER_MS + 60_000) } })).toEqual({ severity: 1, code: 'stuck', text: 'Stuck for 46 min' });
    expect(databaseAttention({ ...base, current: { since: ago(3 * 3_600_000) } })?.text).toBe('Stuck for 3 h');
    expect(databaseAttention({ ...base, current: { since: ago(130 * 60_000) } })?.text).toBe('Stuck for 2 h');
    expect(databaseAttention({ ...base, current: { since: ago(5 * 60_000) } })).toBeUndefined();
    expect(databaseAttention({ ...base, current: { since: 'not a date' } })).toBeUndefined();
  });

  it('an agent silent for more than a day while the lab runs is a warning; a shorter gap is a laptop asleep', () => {
    const silent = (ms: number, extra: Record<string, unknown> = {}) => databaseAttention({ ...base, agentOnline: false, agentLastSeen: ago(ms), ...extra });
    expect(silent(OFFLINE_AFTER_MS)).toBeUndefined();
    expect(silent(OFFLINE_AFTER_MS + 3_600_000)).toEqual({ severity: 1, code: 'agent_offline', text: 'Agent offline for 25 h' });
    expect(silent(60 * 3_600_000)?.text).toBe('Agent offline for 2 d');
    expect(silent(10 * 3_600_000)).toBeUndefined();
    expect(silent(100 * 3_600_000, { agentOnline: true })).toBeUndefined();
    expect(silent(100 * 3_600_000, { state: 'stopped' })).toBeUndefined();
    expect(databaseAttention({ ...base, agentOnline: false })).toBeUndefined(); // never seen: nothing to measure
  });

  it('the most serious reason wins, and within a level the listed order', () => {
    const stuckAndOffline = { ...base, agentOnline: false, agentLastSeen: ago(100 * 3_600_000), current: { since: ago(3 * 3_600_000) } };
    expect(databaseAttention(stuckAndOffline)?.code).toBe('stuck');
    expect(databaseAttention({ ...stuckAndOffline, newestGrade: { status: 'failed' } })?.code).toBe('stuck');
    expect(databaseAttention({ ...stuckAndOffline, newestGrade: { status: 'completed', output: graderLine(['x']) } })?.code).toBe('hard_fail');
    expect(databaseAttention({ ...stuckAndOffline, state: 'error', newestGrade: { status: 'completed', output: graderLine(['x']) } })?.code).toBe('lab_failed');
    expect(databaseAttention({ ...base, agentOnline: false, agentLastSeen: ago(100 * 3_600_000), newestGrade: { status: 'failed' } })?.code).toBe('agent_offline');
  });
});
