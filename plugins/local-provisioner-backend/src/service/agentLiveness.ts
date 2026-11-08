/**
 * The one rule for "has this agent gone quiet?". Before this module the rule (`last_seen` within
 * 90 s) was copied into five places and was 3x longer than it needed to be: a healthy agent
 * re-polls within seconds of every answer, so it is never silent for longer than one poll plus a
 * little. A stopped agent (laptop asleep, wifi gone, process killed behind a proxy that hides the
 * disconnect) kept reading "online" for ~90 s — long enough to start a lab on it (2026-10-31).
 *
 * This is the DISPLAY rule. Decisions that must not be wrong (queueing a lab, the first template
 * step) confirm with AgentService.confirmAlive() instead of trusting an age.
 */

/** `localProvisioner.pollTimeoutSeconds` default (25 s). */
export const DEFAULT_POLL_TIMEOUT_MS = 25_000;

/**
 * Slack on top of one poll length. A healthy agent's worst real gaps: it recovers from a failed
 * poll after client abort (poll + 5 s) + 5 s retry, and `docker info` (15 s timeout) runs on its
 * poll path once every 10 minutes. 20 s keeps both from flickering "offline".
 */
export const SILENCE_GRACE_MS = 20_000;

/** Longest an agent may go without starting a poll before it reads as gone. */
export function silenceLimitMs(pollTimeoutMs: number): number {
  return pollTimeoutMs + SILENCE_GRACE_MS;
}

/** True when the agent started a poll recently enough to still count as connected. */
export function heardRecently(
  lastSeen: Date | string | null | undefined,
  pollTimeoutMs: number,
  nowMs: number = Date.now(),
): boolean {
  if (!lastSeen) return false;
  const seen = new Date(lastSeen).getTime();
  if (Number.isNaN(seen)) return false;
  return nowMs - seen <= silenceLimitMs(pollTimeoutMs);
}
