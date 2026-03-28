/**
 * Canonical department team IDs — single source of truth for the onboarding plugin.
 * Frontend consumers import from @internal/plugin-onboarding.
 * Backend (permission.ts) maintains its own parallel list; keep in sync manually.
 */

export const DEPT_TEAM_IDS = [
  'general-engineers',
  'web-team',
  'mobile-team',
  'data-team',
  'cloud-team',
  'ai-team',
  'qa-team',
] as const;

/**
 * JWT-safe list: excludes general-engineers because auto-provision issues that group
 * to ALL new users before registration. Use this when checking ownershipEntityRefs (JWT) directly.
 */
export const DEPT_TEAM_IDS_JWT = DEPT_TEAM_IDS.filter(
  t => t !== 'general-engineers',
) as ReadonlyArray<string>;
