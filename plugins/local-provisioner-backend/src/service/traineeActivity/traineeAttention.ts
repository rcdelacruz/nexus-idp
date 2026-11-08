/**
 * The one reason an instructor should look at a trainee first, from data the portal already holds (no GitHub). The GitHub reasons
 * (CI failing, no commits for days) are added on the page when a row's repository data has loaded.
 */
export type AttentionCode = 'lab_failed' | 'hard_fail' | 'stuck' | 'agent_offline' | 'grade_unfinished';

export interface Attention {
  /** 2 = something is wrong, 1 = worth a look. */
  severity: 1 | 2;
  code: AttentionCode;
  text: string;
}

/** A provision or lifecycle task that has been pending or running this long is stuck (the Linux VM seed takes up to about 30 min). */
export const STUCK_AFTER_MS = 45 * 60_000;
/** A running lab whose agent has been silent this long. A laptop that sleeps at night is normal, so shorter gaps say nothing. */
export const OFFLINE_AFTER_MS = 24 * 3_600_000;

/**
 * The capstone graders print one JSON object as the last line (`{phase, auto_total, items[], hard_fails[], manual, notes}`). Returns
 * the number of hard fails, or undefined when the output is not a grade. Mirrors `parseGrade` in the frontend (api/labReport.ts); both
 * are pinned by the same sample outputs.
 */
export function parseGradeOutcome(output?: string): { hardFails: number } | undefined {
  const line = (output ?? '')
    .split('\n')
    .map(l => l.trim())
    .reverse()
    .find(l => l.startsWith('{'));
  if (!line) return undefined;
  let r: any;
  try {
    r = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!r || typeof r !== 'object' || !Array.isArray(r.items) || typeof r.auto_total !== 'number') return undefined;
  return { hardFails: Array.isArray(r.hard_fails) ? r.hard_fails.length : 0 };
}

export interface AttentionInput {
  /** The lab's folded state (`running`, `error`, `provisioning`, `stopped`, `removed`) or `none`. */
  state: string;
  /** Only the trainee's newest lab of a course can be "failed": every wizard run makes a new resource name, so older failed ones stay in the data. */
  isNewestLab: boolean;
  /** The lab's task still pending or running. */
  current?: { since: string | Date };
  agentOnline: boolean;
  agentLastSeen?: string | Date;
  /** The lab's newest check named `grade*` (any status), with its result when it finished. */
  newestGrade?: { status: string; output?: string };
  now: Date;
}

const plural = (n: number, unit: string) => `${n} ${unit}`;
const duration = (ms: number) => {
  const min = Math.floor(ms / 60_000);
  if (min < 120) return plural(min, 'min');
  const h = Math.floor(min / 60);
  return h < 48 ? plural(h, 'h') : plural(Math.floor(h / 24), 'd');
};

export function databaseAttention(i: AttentionInput): Attention | undefined {
  // Serious first.
  if (i.state === 'error' && i.isNewestLab) return { severity: 2, code: 'lab_failed', text: 'Lab failed' };
  if (i.newestGrade?.status === 'completed') {
    const outcome = parseGradeOutcome(i.newestGrade.output);
    if (outcome && outcome.hardFails > 0) return { severity: 2, code: 'hard_fail', text: 'Hard fail in last grade' };
  }
  // Then worth a look.
  if (i.current) {
    const since = new Date(i.current.since).getTime();
    if (Number.isFinite(since) && i.now.getTime() - since > STUCK_AFTER_MS) {
      return { severity: 1, code: 'stuck', text: `Stuck for ${duration(i.now.getTime() - since)}` };
    }
  }
  if (i.state === 'running' && !i.agentOnline && i.agentLastSeen) {
    const seen = new Date(i.agentLastSeen).getTime();
    if (Number.isFinite(seen) && i.now.getTime() - seen > OFFLINE_AFTER_MS) {
      return { severity: 1, code: 'agent_offline', text: `Agent offline for ${duration(i.now.getTime() - seen)}` };
    }
  }
  if (i.newestGrade?.status === 'failed') return { severity: 1, code: 'grade_unfinished', text: 'Last grade did not finish' };
  return undefined;
}
