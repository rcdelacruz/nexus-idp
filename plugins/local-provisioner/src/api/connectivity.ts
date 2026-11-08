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
  // (e.g. "only while the age is within the online window") looked right for a while, then
  // regressed back to 'degraded' once the age passed it — reporting a definitively-offline
  // agent as merely "slow" (found 2026-07-26, live in prod: chip flipped correctly to offline
  // immediately, then wrongly back to "degraded" ~4 minutes later with nothing having
  // changed). Only a real reconnect clears this flag server-side.
  if (agent.explicitlyDisconnected) return 'offline';

  // Prefer the server-computed age (skew-free); fall back to client clock only if absent.
  const ageSec =
    agent.lastSeenAgeSeconds !== null && agent.lastSeenAgeSeconds !== undefined
      ? agent.lastSeenAgeSeconds
      : (Date.now() - new Date(agent.lastSeenAt).getTime()) / 1000;

  // "Online" is the SERVER's verdict (AgentService.isConnectedAt: heard from within one poll + a
  // little, and not known to have stopped), the same one the lab guardrail uses. Re-deriving a
  // window here is how the chip said "online" for a minute and a half after an agent stopped.
  if (agent.isConnected) return 'online';
  // Not connected, but heard from recently: reconnecting (display only: the Provision button and
  // the guardrail both need 'online').
  if (ageSec <= 120) return 'degraded';
  return 'offline';
}
