/**
 * Live progress for the portal's activity timeline: what step a lab is on, how far along, and the
 * last lines of output — so a 10–20 minute setup never shows a bare "in progress".
 */

export type ProgressReporter = (phase: string, detail?: Record<string, unknown>) => void;

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** The last `maxLines` lines of a command's output: colour codes stripped, `\r` redraws collapsed. */
export class OutputTail {
  private lines: string[] = [];
  private partial = '';

  constructor(private readonly maxLines = 25) {}

  push(chunk: string): void {
    const text = this.partial + chunk.replace(ANSI, '');
    const parts = text.split('\n');
    this.partial = parts.pop() ?? '';
    for (const p of parts) this.add(p);
  }

  /** The tail, including an unfinished last line. */
  text(): string {
    const last = this.clean(this.partial);
    return [...this.lines, ...(last ? [last] : [])].slice(-this.maxLines).join('\n');
  }

  private add(raw: string) {
    const line = this.clean(raw);
    if (!line) return;
    this.lines.push(line);
    if (this.lines.length > this.maxLines) this.lines.shift();
  }

  /** A progress bar redraws one line with `\r`; only its final state matters. */
  private clean(raw: string): string {
    const frames = raw.split('\r').map(s => s.trimEnd()).filter(Boolean);
    return (frames[frames.length - 1] ?? '').slice(0, 300);
  }
}

/**
 * Wrap the portal reporter: a new step goes out at once; updates within the same step (percent,
 * output) at most every `intervalMs`, the latest one winning. Every update carries the agent's
 * clock (`at`) so the portal orders steps that arrive out of order.
 */
export function throttledReporter(
  send: ProgressReporter,
  intervalMs = 3000,
  now: () => number = Date.now,
  schedule: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
): ProgressReporter {
  let lastPhase: string | undefined;
  let lastSent = 0;
  let pending: { phase: string; detail?: Record<string, unknown> } | undefined;
  let timer = false;
  const emit = (phase: string, detail?: Record<string, unknown>) => {
    lastSent = now();
    send(phase, { ...detail, at: new Date(lastSent).toISOString() });
  };
  return (phase, detail) => {
    if (phase !== lastPhase) {
      lastPhase = phase;
      pending = undefined;
      emit(phase, detail);
      return;
    }
    pending = { phase, detail };
    const wait = intervalMs - (now() - lastSent);
    if (wait <= 0) {
      pending = undefined;
      emit(phase, detail);
      return;
    }
    if (timer) return;
    timer = true;
    schedule(() => {
      timer = false;
      // A newer step already superseded this one.
      if (pending && pending.phase === lastPhase) emit(pending.phase, pending.detail);
      pending = undefined;
    }, wait);
  };
}

/** "Retrieving image: 45%" / "Downloading 12.3%" → 45 / 12. */
export function percentIn(line: string): number | undefined {
  const m = /(\d{1,3}(?:\.\d+)?)\s?%/.exec(line);
  if (!m) return undefined;
  const n = Math.floor(Number(m[1]));
  return n >= 0 && n <= 100 ? n : undefined;
}

/**
 * Reads `docker compose pull` / `up` output line by line and says what step it shows. Stateful,
 * because Compose v5 names the image once ("Image <project>-app Building") and then prints bare
 * build steps ("#6 [2/3] RUN …"); Compose v2 puts the service in the step ("#6 [app 2/3] RUN").
 * Real lines (Compose v5.6.1):
 *   " Image busybox:1.36.1 Pulling"   " 034d6572bf28 Downloading 1.049MB"   (layer: ignored)
 *   " Image lab-app Building"   "#6 [2/3] RUN npm ci"   " Image lab-app Built"
 *   " Container lab-app-1 Started"
 */
export class ComposeProgress {
  private building?: string;

  /** `project`: the Compose project name, stripped from built image names ("lab-app" → "app"). */
  constructor(private readonly project?: string) {}

  line(raw: string): { phase: string; detail?: Record<string, unknown> } | undefined {
    const line = raw.replace(/^\s*[✔✓⠿✘]\s*/, '').trim();
    let m: RegExpExecArray | null;
    if ((m = /^Image\s+(\S+)\s+Building\b/i.exec(line))) {
      this.building = this.serviceOf(m[1]);
      return { phase: `Building ${this.building} from source` };
    }
    if ((m = /^#\d+\s+\[(?:([a-z0-9][\w.-]*)\s+)?(\d+)\/(\d+)\]/i.exec(line))) {
      const service = m[1] && m[1].toLowerCase() !== 'internal' ? m[1] : this.building;
      if (!service) return undefined;
      const [step, total] = [Number(m[2]), Number(m[3])];
      return { phase: `Building ${service} from source`, detail: { progress: { percent: Math.round((step / total) * 100), step: `${step}/${total}` } } };
    }
    if (/^Image\s+\S+\s+Built\b/i.test(line)) {
      this.building = undefined;
      return undefined;
    }
    if (/^Container\s+\S+\s+(?:Creat|Start|Recreat|Running)/i.test(line)) return { phase: 'Starting the containers' };
    if ((m = /^Image\s+(\S+)\s+(?:Pulling|Pulled)\b/i.exec(line))) return { phase: 'Downloading images', detail: { image: m[1] } };
    if (/^[0-9a-f]{12}\s/i.test(line)) return undefined; // a layer of the image being pulled
    if ((m = /^([a-z0-9][\w.-]*)\s+(?:Pulling|Pulled)\b/i.exec(line)) ?? (m = /^Pulling\s+([^\s.]+)/i.exec(line))) {
      if (!/^(?:Container|Network|Volume|Image)$/i.test(m[1])) return { phase: 'Downloading images', detail: { image: m[1] } };
    }
    return undefined;
  }

  private serviceOf(image: string): string {
    const p = this.project?.toLowerCase();
    return p && image.toLowerCase().startsWith(`${p}-`) ? image.slice(p.length + 1) : image;
  }
}
