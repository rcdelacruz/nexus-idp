/**
 * The teams a project can have. The registration form offers exactly these seven, and the permission policy
 * (packages/backend permission.ts) turns a project's team into a catalog-visibility claim for the project manager who created it:
 * `group:default/<team_name>`. With free text, a project manager could type any group (`devops-team`, `backstage-admins`) and read
 * everything that group owns (audit 2026-11-07). Keep this list in step with PROJECT_TEAMS in ProjectRegistrationPage.tsx and with
 * PROJECT_TEAM_NAMES in permission.ts.
 */
export const PROJECT_TEAM_NAMES = ['web-team', 'mobile-team', 'data-team', 'cloud-team', 'ai-team', 'qa-team', 'sa-team'] as const;

/** An error message, or undefined when the value is fine. Nothing (undefined, null, '') is fine: the team is optional. */
export function teamNameError(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !(PROJECT_TEAM_NAMES as readonly string[]).includes(value)) {
    return `team_name must be one of: ${PROJECT_TEAM_NAMES.join(', ')}`;
  }
  return undefined;
}
