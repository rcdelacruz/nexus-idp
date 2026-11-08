import { validAgentVersion } from './agentRoutes';

export interface MachineInfoInput {
  agentId: string;
  hostname: string;
  platform: string;
  platformVersion: string;
  agentVersion?: string;
}

/** Control characters (below space, and DEL) are removed instead of stored. */
const withoutControlCharacters = (v: string) => [...v].filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join('');
const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const clean = withoutControlCharacters(v).trim();
  return clean.length >= 1 && clean.length <= max ? clean : undefined;
};

/**
 * The machine description an agent sends with POST /agent/device/code (an UNAUTHENTICATED request). Each field is stored and shown,
 * so each is a bounded string without control characters; the id is the agent's own `agent-<host>-<hash>` charset. Nothing sent is
 * ever logged. A request with some of the fields missing is accepted as before (no machine info); a field that is present but
 * unusable is refused.
 */
export function parseDeviceCodeBody(body: unknown): { ok: true; machine?: MachineInfoInput } | { ok: false; error: string } {
  if (body === undefined || body === null) return { ok: true };
  if (typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'The request body must be a JSON object' };
  const b = body as Record<string, unknown>;
  const present = (k: string) => b[k] !== undefined && b[k] !== null && b[k] !== '';

  const agentId = present('agent_id') ? text(b.agent_id, 300) : undefined;
  const hostname = present('hostname') ? text(b.hostname, 255) : undefined;
  const platform = present('platform') ? text(b.platform, 32) : undefined;
  const platformVersion = present('platform_version') ? text(b.platform_version, 128) : undefined;

  if (present('agent_id') && (!agentId || !/^[A-Za-z0-9._-]+$/.test(agentId))) return { ok: false, error: 'agent_id is not valid' };
  if (present('hostname') && !hostname) return { ok: false, error: 'hostname is not valid' };
  if (present('platform') && (!platform || !/^[A-Za-z0-9_-]+$/.test(platform))) return { ok: false, error: 'platform is not valid' };
  if (present('platform_version') && !platformVersion) return { ok: false, error: 'platform_version is not valid' };

  if (agentId && hostname && platform && platformVersion) {
    return { ok: true, machine: { agentId, hostname, platform, platformVersion, agentVersion: validAgentVersion(b.agent_version) } };
  }
  return { ok: true };
}
