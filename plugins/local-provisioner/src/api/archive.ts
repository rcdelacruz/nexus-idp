/** A capstone an instructor marked done sits in the Archive; everything else is on the Active list. */
export const isArchived = (row: { capstone?: { status: string } }): boolean => row.capstone?.status === 'completed';

/** 365 -> "1 year", 730 -> "2 years", 90 -> "90 days", 1 -> "1 day". */
export function formatRetention(days: number): string {
  if (days >= 365 && days % 365 === 0) return days === 365 ? '1 year' : `${days / 365} years`;
  return days === 1 ? '1 day' : `${days} days`;
}

/** Whole days left until `expiresAt` (never negative), or undefined when there is no date. */
export function daysLeft(expiresAt: string | undefined, now: number = Date.now()): number | undefined {
  const t = expiresAt ? Date.parse(expiresAt) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - now) / 86_400_000)) : undefined;
}
