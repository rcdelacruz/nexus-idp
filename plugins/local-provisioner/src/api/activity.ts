import { ProvisioningTask } from './types';

/**
 * What a lab is doing, in words a trainee understands. The agent reports a step name per phase
 * (`metadata.phase`); the portal keeps them as a timeline (`metadata.activity`). Older agents send
 * terse names, mapped here; anything unknown is shown as sent.
 */
const STEP_LABELS: Array<[RegExp, string]> = [
  [/^pulling-images$/i, 'Downloading images'],
  [/^images-cached$/i, 'Images already on this machine'],
  [/^starting$/i, 'Starting the containers'],
  [/^creating the vm$/i, 'Creating the VM'],
  [/^copying /i, 'Copying the lab files into the VM'],
  [/^seeding the server/i, 'Setting up the server'],
  [/^starting the vm$/i, 'Starting the VM'],
  [/^completed$/i, 'Ready'],
  [/^failed$/i, 'Failed'],
];

/** Typical length of the slow steps, shown while they run so a long wait doesn't look stuck. */
const STEP_HINTS: Array<[RegExp, string]> = [
  [/^Creating the VM/, 'the first VM lab downloads Ubuntu (about 1 GB)'],
  [/^Setting up the server/, 'usually 10–20 min'],
  [/^Downloading images/, 'first time only; later labs reuse them'],
  [/^Building /, 'builds the app from source; a few minutes'],
];

export function stepLabel(raw: string): string {
  for (const [re, label] of STEP_LABELS) if (re.test(raw)) return label;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function stepHint(label: string): string | undefined {
  return STEP_HINTS.find(([re]) => re.test(label))?.[1];
}

export interface TimelineEntry {
  label: string;
  at: string;
  /** Until the next step, or until now for the step still running. */
  durationMs: number;
  running: boolean;
}

/** The task's steps, oldest first; consecutive steps with the same label are merged. */
export function timeline(task: ProvisioningTask, now: Date = new Date()): TimelineEntry[] {
  const raw = Array.isArray(task.metadata?.activity) ? (task.metadata!.activity as Array<{ at: string; step: string }>) : [];
  const steps: Array<{ label: string; at: string }> = [];
  for (const e of raw) {
    if (!e || typeof e.step !== 'string' || typeof e.at !== 'string') continue;
    const label = stepLabel(e.step);
    if (steps[steps.length - 1]?.label !== label) steps.push({ label, at: e.at });
  }
  const open = task.status === 'pending' || task.status === 'in-progress';
  const end = open ? now.getTime() : Date.parse(task.completedAt ?? task.updatedAt);
  return steps.map((s, i) => {
    const next = steps[i + 1];
    const last = !next;
    const until = next ? Date.parse(next.at) : end;
    const terminal = last && (s.label === 'Ready' || s.label === 'Failed');
    return { ...s, durationMs: terminal ? 0 : Math.max(0, until - Date.parse(s.at)), running: last && open };
  });
}

/** For a task still pending/running: what it is doing and for how long. */
export function currentStep(task: ProvisioningTask, now: Date = new Date()): { label: string; sinceMs: number; hint?: string; percent?: number } | undefined {
  if (task.status === 'pending') {
    return { label: 'Waiting for your agent to pick it up', sinceMs: now.getTime() - Date.parse(task.createdAt) };
  }
  if (task.status !== 'in-progress') return undefined;
  const steps = timeline(task, now);
  const last = steps[steps.length - 1];
  const percent = Number((task.metadata?.progress as any)?.percent);
  if (!last) {
    return { label: 'Starting', sinceMs: now.getTime() - Date.parse(task.startedAt ?? task.createdAt) };
  }
  return {
    label: last.label,
    sinceMs: last.durationMs,
    hint: stepHint(last.label),
    percent: Number.isFinite(percent) && percent >= 0 && percent <= 100 ? Math.round(percent) : undefined,
  };
}

/** "8 s", "6 min", "1 h 5 min". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}
