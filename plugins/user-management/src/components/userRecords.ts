/**
 * What the User Management table shows for one person, built from the backend's user row.
 *
 * One place builds the "groups" shown for a person (`groupsOf`), so the table, the Assign dialog and
 * the Instructor action show the same list. It follows `UserEntityProvider.buildMemberOf` on the
 * backend, except that it lists only what the person's own row carries: `general-engineers` appears
 * when it is one of their teams, and the implicit `general-engineers` the backend adds for everyone
 * is not shown.
 */

export const DEPT_TEAMS = [
  'general-engineers', 'web-team', 'mobile-team', 'data-team', 'cloud-team', 'ai-team', 'qa-team', 'pm-team', 'sa-team',
];

/** A row of `GET /users`. */
export interface UserRow {
  name: string;
  display_name: string;
  email: string;
  teams: string[];
  is_lead: boolean;
  is_admin: boolean;
  /** Absent when the backend predates the instructor role. */
  is_instructor?: boolean;
  github_username: string | null;
  onboarding_catalog_tour?: boolean;
  onboarding_engineering_docs?: boolean;
}

export interface UserRecord {
  entityRef: string;
  name: string;
  displayName: string;
  email: string;
  picture?: string;
  currentGroups: string[];
  deptTeams: string[]; // all assigned dept teams (multi-department supported)
  isLead: boolean;
  isAdmin: boolean;
  isInstructor: boolean;
  isUnassigned: boolean;
  githubLinked: boolean;
  onboardingCatalogTour: boolean;
  onboardingEngineeringDocs: boolean;
}

export const groupsOf = (
  deptTeams: string[],
  isLead: boolean,
  isAdmin: boolean,
  isInstructor: boolean,
): string[] => [
  ...deptTeams,
  ...(isLead ? deptTeams.map(t => t.replace('-team', '-lead')) : []),
  ...(isAdmin ? ['backstage-admins'] : []),
  ...(isInstructor ? ['instructors'] : []),
];

/**
 * Who appears in the table: anyone with a team (including general-engineers), an admin, or an
 * instructor. Ghost rows (GitHub linked before onboarding: no team, no role) are artifacts.
 */
export const isListed = (row: UserRow): boolean =>
  row.teams.length > 0 || row.is_admin || !!row.is_instructor;

export const toUserRecord = (row: UserRow): UserRecord => {
  const deptTeams = row.teams.filter(g => DEPT_TEAMS.includes(g));
  const isInstructor = !!row.is_instructor;
  return {
    entityRef: `user:default/${row.name}`,
    name: row.name,
    displayName: row.display_name,
    email: row.email,
    currentGroups: groupsOf(deptTeams, row.is_lead, row.is_admin, isInstructor),
    deptTeams,
    isLead: row.is_lead,
    isAdmin: row.is_admin,
    isInstructor,
    isUnassigned: deptTeams.length === 0 && !row.is_admin,
    githubLinked: !!row.github_username,
    onboardingCatalogTour: row.onboarding_catalog_tour ?? false,
    onboardingEngineeringDocs: row.onboarding_engineering_docs ?? false,
  };
};
