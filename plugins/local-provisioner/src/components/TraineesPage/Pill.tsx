import React from 'react';
import { CheckCircle, Loader, PauseCircle, XCircle } from 'lucide-react';
import { badge } from '@stratpoint/theme-utils';

export type PillTone = 'red' | 'amber' | 'green' | 'blue' | 'gray';

/**
 * A state or a problem as the User Management page draws one: the portal's `badge()` (a tinted pill, readable on every theme).
 * It is not a button: it has no border, no hover and no pointer, so it cannot be mistaken for one.
 */
export function Pill({ tone, icon, children, maxWidth, ...rest }: { tone: PillTone; icon?: React.ReactNode; children: React.ReactNode; maxWidth?: number } & Record<`data-${string}`, unknown>) {
  return (
    <span style={{ ...badge(tone), gap: 4, maxWidth, minWidth: 0 }} {...rest}>
      {icon}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
    </span>
  );
}

export const STATE_TEXT: Record<string, string> = { running: 'running', provisioning: 'setting up', stopped: 'stopped', error: 'failed', none: 'no environment', removed: 'removed' };

/** A lab's state. "No environment" is plain text: there is no lab. */
export function StatePill({ state }: { state: string }) {
  const text = STATE_TEXT[state] ?? state;
  switch (state) {
    case 'running':
      return <Pill tone="green" icon={<CheckCircle size={12} strokeWidth={2} aria-hidden="true" />}>{text}</Pill>;
    case 'provisioning':
      return <Pill tone="blue" icon={<Loader size={12} strokeWidth={2} aria-hidden="true" />}>{text}</Pill>;
    case 'error':
      return <Pill tone="red" icon={<XCircle size={12} strokeWidth={2} aria-hidden="true" />}>{text}</Pill>;
    case 'stopped':
    case 'removed':
      return <Pill tone="gray" icon={<PauseCircle size={12} strokeWidth={2} aria-hidden="true" />}>{text}</Pill>;
    default:
      return <span>{text}</span>;
  }
}
