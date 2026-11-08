/** One-line summary of a check's output: the seeded-resources check prints {checked, missing}. */
export function checkSummary(c: { status: string; exitCode?: number; output?: string }): string {
  // Backend task status values: pending, in-progress, completed, failed.
  if (c.status === 'pending' || c.status === 'in-progress') return 'running…';
  const json = (c.output ?? '').split('\n').map(l => l.trim()).reverse().find(l => l.startsWith('{'));
  try {
    const r = json ? JSON.parse(json) : undefined;
    if (r && typeof r.checked === 'number' && Array.isArray(r.missing)) {
      return r.missing.length ? `${r.missing.length} of ${r.checked} missing or replaced: ${r.missing.join(', ')}` : `all ${r.checked} intact`;
    }
    // Capstone grader JSON: {phase, items: [{points, got}], hard_fails: [], auto_total}
    if (r && Array.isArray(r.items) && typeof r.auto_total === 'number') {
      const max = r.items.reduce((sum: number, i: any) => sum + (Number(i.points) || 0), 0);
      const hard = Array.isArray(r.hard_fails) ? r.hard_fails : [];
      return `${r.auto_total}/${max} automated points${r.phase ? ` (${r.phase})` : ''}${hard.length ? ` · ${hard.length} HARD FAIL: ${hard.join('; ')}` : ' · no hard fails'}`;
    }
  } catch {
    // fall through to the exit code
  }
  if (c.exitCode === 0) return 'passed';
  if (c.exitCode === undefined || c.exitCode === null) {
    // Failed before the check ran (no exit code): the agent's reason is the useful part.
    const reason = (c.output ?? '').trim().split('\n').pop()?.trim();
    return reason ? `did not run: ${reason.slice(0, 200)}` : 'did not run';
  }
  return `failed (exit ${c.exitCode})`;
}
