/**
 * "You just started this run": the mark the Create wizard puts on the run page it opens, so that
 * page can send you to your lab when the run succeeds. A run opened any other way (from the
 * scaffolder's task list, an old link, history) carries no mark and is never redirected: someone
 * reading a finished run's log must be left there.
 *
 * Browser history keeps this state across a reload and Back/Forward, so the mark also expires.
 */
export const LAB_REDIRECT_WINDOW_MS = 30 * 60 * 1000;

/** The navigation state for the run page the wizard opens. */
export function newRunState(now: number = Date.now()): { labRedirectAt: number } {
  return { labRedirectAt: now };
}

/** True when the navigation state says the run was started by this user a moment ago. */
export function isFreshRun(state: unknown, now: number = Date.now()): boolean {
  const at = (state as { labRedirectAt?: unknown } | null | undefined)?.labRedirectAt;
  if (typeof at !== 'number' || !Number.isFinite(at)) return false;
  const age = now - at;
  return age >= 0 && age <= LAB_REDIRECT_WINDOW_MS;
}
