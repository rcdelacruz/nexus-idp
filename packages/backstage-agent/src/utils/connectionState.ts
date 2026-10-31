/**
 * The daemon's last contact with the portal, for `backstage-agent status`. The status command
 * can't ask the portal itself (the agent list needs a signed-in user, not the agent token), and
 * every successful poll already proves the connection, so the daemon records it here.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ConnectionState {
  /** ISO time this daemon started (a fresh start has no contact yet: the first poll is held up to ~25 s). */
  startedAt?: string;
  /** ISO time of the last successful poll. */
  lastContactAt?: string;
  /** Last poll failure since that contact (cleared by the next success). */
  lastError?: string;
  lastErrorAt?: string;
}

/** A poll returns at least every ~25 s, so a contact older than this means the agent is not reaching the portal. */
export const CONNECTED_WITHIN_MS = 90_000;

const stateFile = () => path.join(os.homedir(), '.backstage-agent', 'connection.json');

function write(state: ConnectionState): void {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(state));
  } catch {
    // Status reporting must never break the agent.
  }
}

export function readConnectionState(): ConnectionState {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf-8'));
  } catch {
    return {};
  }
}

/** A new daemon: forget the previous run's contact and errors. */
export function recordStart(now: Date = new Date()): void {
  write({ startedAt: now.toISOString() });
}

export function recordContact(now: Date = new Date()): void {
  write({ startedAt: readConnectionState().startedAt, lastContactAt: now.toISOString() });
}

export function recordPollError(message: string, now: Date = new Date()): void {
  write({ ...readConnectionState(), lastError: message, lastErrorAt: now.toISOString() });
}

/** Started recently and still waiting for its first answer from the portal. */
export function isConnecting(state: ConnectionState, now: Date = new Date()): boolean {
  return !state.lastContactAt && Boolean(state.startedAt) && now.getTime() - new Date(state.startedAt!).getTime() <= CONNECTED_WITHIN_MS;
}

export function isConnected(state: ConnectionState, now: Date = new Date()): boolean {
  return Boolean(state.lastContactAt) && now.getTime() - new Date(state.lastContactAt!).getTime() <= CONNECTED_WITHIN_MS;
}

const NETWORK_ERRORS: Record<string, string> = {
  ECONNREFUSED: 'the connection was refused',
  ENOTFOUND: 'the address could not be resolved (offline, or a VPN/DNS problem?)',
  EAI_AGAIN: 'the address could not be resolved (offline, or a VPN/DNS problem?)',
  ETIMEDOUT: 'the connection timed out',
  ECONNRESET: 'the connection was dropped',
  EHOSTUNREACH: 'the network is unreachable',
  ENETUNREACH: 'the network is unreachable',
  CERT_HAS_EXPIRED: 'the server certificate has expired',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'the server certificate could not be verified (a proxy intercepting HTTPS?)',
  SELF_SIGNED_CERT_IN_CHAIN: 'the server certificate could not be verified (a proxy intercepting HTTPS?)',
};

/** One short line for a failed poll: "Cannot reach portal.example.com: the connection was refused". */
export function describePollError(error: { code?: string; name?: string; message?: string }, portalUrl: string): string {
  let host = portalUrl;
  try {
    host = new URL(portalUrl).host;
  } catch {
    // keep the raw value
  }
  if (error.name === 'AbortError') return `Cannot reach ${host}: no answer within the poll timeout`;
  const known = error.code && NETWORK_ERRORS[error.code];
  return `Cannot reach ${host}: ${known || (error.code ?? error.message ?? 'unknown error')}`;
}
