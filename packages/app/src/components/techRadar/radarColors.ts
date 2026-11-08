import { semantic } from '@stratpoint/theme-utils';
import { RingId } from './radarModel';

/** Ring colours come from the design system's semantic palette, not from the data. */
const COLORS: Record<RingId, string> = {
  adopt: semantic.success,
  trial: semantic.info,
  assess: semantic.warning,
  caution: semantic.error,
  hold: semantic.error,
};

export const ringColor = (ring: RingId): string => COLORS[ring];
