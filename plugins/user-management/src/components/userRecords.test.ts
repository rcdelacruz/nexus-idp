import { UserRow, groupsOf, isListed, toUserRecord } from './userRecords';

const row = (over: Partial<UserRow> = {}): UserRow => ({
  name: 'ann.cruz',
  display_name: 'Ann Cruz',
  email: 'ann.cruz@example.com',
  teams: ['web-team'],
  is_lead: false,
  is_admin: false,
  github_username: null,
  ...over,
});

describe('groupsOf', () => {
  it('lists teams, then lead groups, then admin, then instructors', () => {
    expect(groupsOf(['web-team', 'cloud-team'], true, true, true)).toEqual([
      'web-team', 'cloud-team', 'web-lead', 'cloud-lead', 'backstage-admins', 'instructors',
    ]);
  });

  it('adds only what applies', () => {
    expect(groupsOf(['web-team'], false, false, false)).toEqual(['web-team']);
    expect(groupsOf(['web-team'], false, false, true)).toEqual(['web-team', 'instructors']);
    expect(groupsOf([], false, true, false)).toEqual(['backstage-admins']);
    expect(groupsOf([], false, false, true)).toEqual(['instructors']);
  });
});

describe('isListed', () => {
  it('shows people with a team, an admin or an instructor', () => {
    expect(isListed(row())).toBe(true);
    expect(isListed(row({ teams: ['general-engineers'] }))).toBe(true);
    expect(isListed(row({ teams: [], is_admin: true }))).toBe(true);
    expect(isListed(row({ teams: [], is_instructor: true }))).toBe(true);
  });

  it('hides ghost rows (GitHub linked before onboarding: no team, no role)', () => {
    expect(isListed(row({ teams: [] }))).toBe(false);
    expect(isListed(row({ teams: [], is_instructor: false }))).toBe(false);
  });
});

describe('toUserRecord', () => {
  it('keeps the instructor role next to the team and shows it as a group', () => {
    const rec = toUserRecord(row({ teams: ['web-team'], is_instructor: true }));
    expect(rec).toMatchObject({
      name: 'ann.cruz', entityRef: 'user:default/ann.cruz', displayName: 'Ann Cruz',
      deptTeams: ['web-team'], isInstructor: true, isAdmin: false, isUnassigned: false,
      currentGroups: ['web-team', 'instructors'],
    });
  });

  it('treats a row from a backend without the role as not an instructor', () => {
    const rec = toUserRecord(row());
    expect(rec.isInstructor).toBe(false);
    expect(rec.currentGroups).toEqual(['web-team']);
  });

  it('a trainee-only instructor keeps general-engineers (a listed team here) and gets the group', () => {
    const rec = toUserRecord(row({ teams: ['general-engineers'], is_instructor: true }));
    expect(rec.deptTeams).toEqual(['general-engineers']);
    expect(rec.isUnassigned).toBe(false);
    expect(rec.currentGroups).toEqual(['general-engineers', 'instructors']);
  });

  it('is unchanged for admins and leads', () => {
    expect(toUserRecord(row({ teams: ['cloud-team'], is_lead: true })).currentGroups).toEqual(['cloud-team', 'cloud-lead']);
    const admin = toUserRecord(row({ teams: [], is_admin: true }));
    expect(admin).toMatchObject({ isAdmin: true, isUnassigned: false, currentGroups: ['backstage-admins'] });
  });
});
