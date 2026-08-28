/**
 * Shared agent-connectivity bucketing, used by both the polling hook (to decide whether
 * anything meaningfully changed) and the display components (to render it). Keeping this in
 * one place matters: previously AgentList.tsx computed this inline while useAgents.ts's
 * change-detection compared unrelated raw fields (lastSeenAt, isConnected) that don't change
 * once an agent goes stale — so the bucket could silently shift (online -> degraded -> offline)
 * with the UI never re-rendering to show it, forcing a manual page refresh to see current
 * state (found 2026-07-26).
 */
import { AgentRegistration } from './types';

export type Connectivity = 'online' | 'degraded' | 'offline';

export function getConnectivity(agent: AgentRegistration): Connectivity {
  // explicitlyDisconnected is a standalone, permanent signal — true once a "Stop Agent"
  // shutdown has actually been delivered, and it does NOT decay back with elapsed time. It
  // must be checked before, and independently of, age: an age-windowed version of this check
  // (e.g. "only while age <= 90s") looked right for the first minute and a half, then
  // regressed back to 'degraded' once age crossed 90s — reporting a definitively-offline
  // agent as merely "slow" (found 2026-07-26, live in prod: chip flipped correctly to offline
  // immediately, then wrongly back to "degraded" ~4 minutes later with nothing having
  // changed). Only a real reconnect clears this flag server-side.
  if (agent.explicitlyDisconnected) return 'offline';

  // Prefer the server-computed age (skew-free); fall back to client clock only if absent.
  const ageSec =
    agent.lastSeenAgeSeconds !== null && agent.lastSeenAgeSeconds !== undefined
      ? agent.lastSeenAgeSeconds
      : (Date.now() - new Date(agent.lastSeenAt).getTime()) / 1000;

  // Heartbeat/poll interval is ~30s; tolerate a couple of missed beats (and brief backend restarts).
  if (ageSec <= 90) return 'online';
  if (ageSec <= 300) return 'degraded'; // 1.5–5 min: slow/intermittent
  return 'offline'; // no heartbeat for 5+ min
}
