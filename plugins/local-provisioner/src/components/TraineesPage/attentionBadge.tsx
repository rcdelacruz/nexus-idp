import React from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';
import type { TraineeAttention } from '../../api/types';
import { usePageStyles } from './pageStyles';
import { Pill } from './Pill';

/**
 * The one reason to look at a trainee, as a badge: red with a circle for something wrong, amber with a triangle for worth a look.
 * The words say which it is (also for a screen reader), so the colour is never the only carrier.
 */
export function AttentionBadge({ attention }: { attention?: TraineeAttention }) {
  const classes = usePageStyles();
  if (!attention) return <span className={classes.none}>—</span>;
  const serious = attention.severity === 2;
  const Icon = serious ? AlertCircle : AlertTriangle;
  return (
    <Pill tone={serious ? 'red' : 'amber'} icon={<Icon size={12} strokeWidth={2} aria-hidden="true" />} maxWidth={220} data-testid="attention" data-severity={attention.severity}>
      <span className={classes.srOnly}>{serious ? 'Serious: ' : 'Warning: '}</span>
      {attention.text}
    </Pill>
  );
}
