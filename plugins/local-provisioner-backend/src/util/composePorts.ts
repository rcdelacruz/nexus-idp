/**
 * The host TCP ports a Docker Compose file publishes.
 *
 * The portal uses this to tell, before a lab is retried, which of the user's other labs hold the
 * ports it needs. Only ports with a fixed host side count: "80" (Docker picks the host port) and
 * "${PORT}:80" (not filled in) say nothing about what is held. UDP is skipped because the agent's own
 * pre-flight only checks TCP.
 */
import { parse } from 'yaml';

const MAX_RANGE = 256;

function expand(spec: string): number[] {
  const m = /^(\d+)(?:-(\d+))?$/.exec(spec.trim());
  if (!m) return [];
  const from = Number(m[1]);
  const to = m[2] === undefined ? from : Number(m[2]);
  if (from < 1 || to > 65535 || to < from || to - from >= MAX_RANGE) return [];
  const out: number[] = [];
  for (let p = from; p <= to; p++) out.push(p);
  return out;
}

/** `${PORT:-5432}` is 5432 unless PORT is set; the agent sets none of these, so the default is what binds. */
function hostSpec(part: string): string {
  const m = /^\$\{[A-Za-z_][A-Za-z0-9_]*:?-(\d+(?:-\d+)?)\}$/.exec(part.trim());
  return m ? m[1] : part;
}

/** Split on ':' except inside `${...}`, whose default value has its own ':'. */
function splitFields(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    if (ch === ':' && depth === 0) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

/** "127.0.0.1:4566:4566", "8080:80/tcp", "[::1]:9000:9000", "5000-5002:5000-5002" → host ports. */
function fromShortSyntax(entry: string): number[] {
  let text = entry.trim();
  const slash = text.lastIndexOf('/');
  if (slash !== -1) {
    if (text.slice(slash + 1).toLowerCase() !== 'tcp') return [];
    text = text.slice(0, slash);
  }
  text = text.replace(/^\[[^\]]*\]:/, ''); // an IPv6 host address
  const parts = splitFields(text);
  if (parts.length < 2 || parts.length > 3) return []; // container port only: Docker picks the host port
  return expand(hostSpec(parts[parts.length - 2]));
}

function fromLongSyntax(entry: Record<string, unknown>): number[] {
  const protocol = typeof entry.protocol === 'string' ? entry.protocol.toLowerCase() : 'tcp';
  if (protocol !== 'tcp') return [];
  const published = entry.published;
  if (typeof published === 'number') return expand(String(published));
  if (typeof published === 'string') return expand(published);
  return [];
}

function fromEntry(entry: unknown): number[] {
  if (typeof entry === 'string') return fromShortSyntax(entry);
  if (entry && typeof entry === 'object') return fromLongSyntax(entry as Record<string, unknown>);
  return [];
}

export function publishedHostPorts(composeText: unknown): number[] {
  if (typeof composeText !== 'string' || !composeText.trim()) return [];
  let doc: any;
  try {
    doc = parse(composeText);
  } catch {
    return [];
  }
  const services = doc && typeof doc === 'object' ? doc.services : undefined;
  if (!services || typeof services !== 'object') return [];
  const ports = new Set<number>();
  for (const service of Object.values<any>(services)) {
    if (!service || typeof service !== 'object') continue;
    // Not started by a plain `up -d` (needs a profile), or on the host network (`ports` is ignored).
    if (Array.isArray(service.profiles) && service.profiles.length > 0) continue;
    if (service.network_mode === 'host') continue;
    const list = service.ports;
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      for (const p of fromEntry(entry)) ports.add(p);
    }
  }
  return [...ports].sort((a, b) => a - b);
}
