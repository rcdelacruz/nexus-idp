/**
 * CatalogPermissionPolicy — Tech Insights permissions. The policy defaults to DENY, so a
 * permission a new plugin registers is silently denied unless a rule matches it. These tests pin
 * exactly who may run and read Tech Insights checks.
 */
import { AuthorizeResult, createPermission } from '@backstage/plugin-permission-common';
import { PolicyQueryUser } from '@backstage/plugin-permission-node';
import { CatalogPermissionPolicy } from './permission';

const user = (groups: string[]): PolicyQueryUser =>
  ({
    info: { userEntityRef: 'user:default/jane.doe', ownershipEntityRefs: ['user:default/jane.doe', ...groups] },
    token: 'token',
    credentials: {} as any,
  }) as PolicyQueryUser;

const ADMIN = ['group:default/backstage-admins'];
const ENGINEER = ['group:default/web-team'];
const LEAD = ['group:default/web-team', 'group:default/web-lead'];
const UNASSIGNED = ['group:default/general-engineers'];

const checkRun = createPermission({ name: 'tech-insights.check.run', attributes: {} });
const checkRead = createPermission({ name: 'tech-insights.check.read', attributes: { action: 'read' } });
const factRead = createPermission({ name: 'tech-insights.fact-retriever.read', attributes: { action: 'read' } });

describe('CatalogPermissionPolicy — tech-insights', () => {
  const policy = new CatalogPermissionPolicy();
  const decide = async (permission: typeof checkRun, groups: string[]) =>
    (await policy.handle({ permission }, user(groups))).result;

  it.each([
    ['admin', ADMIN],
    ['engineer', ENGINEER],
    ['lead', LEAD],
  ])('lets an %s run checks (the Ops readiness card)', async (_role, groups) => {
    expect(await decide(checkRun, groups)).toBe(AuthorizeResult.ALLOW);
  });

  it('does not let an unassigned user run checks', async () => {
    expect(await decide(checkRun, UNASSIGNED)).toBe(AuthorizeResult.DENY);
  });

  it('keeps the pre-existing .read behavior (allowed for everyone authenticated)', async () => {
    for (const groups of [ENGINEER, UNASSIGNED]) {
      expect(await decide(checkRead, groups)).toBe(AuthorizeResult.ALLOW);
      expect(await decide(factRead, groups)).toBe(AuthorizeResult.ALLOW);
    }
  });

  it('denies unauthenticated requests', async () => {
    expect((await policy.handle({ permission: checkRun })).result).toBe(AuthorizeResult.DENY);
  });

  it('only matches the exact permission name (no tech-insights.* wildcard)', async () => {
    const other = createPermission({ name: 'tech-insights.something.write', attributes: {} });
    expect(await decide(other, ENGINEER)).toBe(AuthorizeResult.DENY);
  });
});

/**
 * Catalog read visibility of templates. Evaluates the policy's conditional decision against
 * template entities with a small evaluator for the three catalog rules the policy uses.
 */
type Cond = any;
const evaluate = (c: Cond, e: any): boolean => {
  if (c.anyOf) return c.anyOf.some((x: Cond) => evaluate(x, e));
  if (c.allOf) return c.allOf.every((x: Cond) => evaluate(x, e));
  if (c.not) return !evaluate(c.not, e);
  switch (c.rule) {
    case 'IS_ENTITY_KIND':
      return c.params.kinds.map((k: string) => k.toLowerCase()).includes(e.kind.toLowerCase());
    case 'IS_ENTITY_OWNER':
      return (e.relations ?? []).some((r: any) => r.type === 'ownedBy' && c.params.claims.includes(r.targetRef));
    case 'HAS_SPEC':
      return e.spec?.[c.params.key] === c.params.value;
    default:
      throw new Error(`unhandled rule ${c.rule}`);
  }
};

const tpl = (type: string, owner: string) => ({
  kind: 'Template',
  spec: { type },
  relations: [{ type: 'ownedBy', targetRef: owner }],
});
const DEVOPS_OWNER = 'group:default/devops-team';

describe('CatalogPermissionPolicy — template visibility', () => {
  const policy = new CatalogPermissionPolicy();
  const { catalogEntityReadPermission } = jest.requireActual('@backstage/plugin-catalog-common/alpha');
  const canSee = async (groups: string[], entity: any) => {
    const d: any = await policy.handle({ permission: catalogEntityReadPermission }, user(groups));
    if (d.result === AuthorizeResult.ALLOW) return true;
    if (d.result === AuthorizeResult.DENY) return false;
    return evaluate(d.conditions, entity);
  };

  it.each([
    ['web engineer', ['group:default/web-team']],
    ['data engineer', ['group:default/data-team']],
    ['qa engineer', ['group:default/qa-team']],
    ['lead', LEAD],
    ['new hire', UNASSIGNED],
  ])('a %s sees devops-owned training labs', async (_role, groups) => {
    expect(await canSee(groups, tpl('training', DEVOPS_OWNER))).toBe(true);
  });

  it('engineers still do not see devops-owned infrastructure templates', async () => {
    expect(await canSee(ENGINEER, tpl('infrastructure', DEVOPS_OWNER))).toBe(false);
  });

  it('leads still do not see devops-owned infrastructure templates', async () => {
    expect(await canSee(LEAD, tpl('infrastructure', DEVOPS_OWNER))).toBe(false);
  });

  it('new hires still see only training templates', async () => {
    expect(await canSee(UNASSIGNED, tpl('service', 'group:default/web-team'))).toBe(false);
  });
});

describe('CatalogPermissionPolicy — Local Provisioner Trainees view', () => {
  const policy = new CatalogPermissionPolicy();
  const traineesRead = createPermission({ name: 'local-provisioner.trainees.read', attributes: { action: 'read' } });
  const traineesManage = createPermission({ name: 'local-provisioner.trainees.manage', attributes: { action: 'delete' } });
  const decide = async (groups: string[]) => {
    const read = (await policy.handle({ permission: traineesRead }, user(groups))).result;
    // Remove trainee (and delete their repo) follows exactly the same rule as reading the view.
    expect((await policy.handle({ permission: traineesManage }, user(groups))).result).toBe(read);
    return read;
  };

  it.each([
    ['admin', ADMIN],
    ['instructor', ['group:default/instructors']],
    ['instructor who is also an engineer', ['group:default/web-team', 'group:default/instructors']],
  ])('allows an %s', async (_role, groups) => {
    expect(await decide(groups)).toBe(AuthorizeResult.ALLOW);
  });

  it.each([
    ['engineer', ENGINEER],
    ['lead', LEAD],
    ['devops', ['group:default/devops-team']],
    ['new hire', UNASSIGNED],
  ])('denies a %s (no generic local-provisioner.* leak)', async (_role, groups) => {
    expect(await decide(groups)).toBe(AuthorizeResult.DENY);
  });
});

describe('CatalogPermissionPolicy — capstones', () => {
  const policy = new CatalogPermissionPolicy();
  const manage = createPermission({ name: 'local-provisioner.capstones.manage', attributes: {} });
  const enroll = createPermission({ name: 'local-provisioner.capstones.enroll', attributes: { action: 'create' } });
  const decide = async (permission: typeof manage, groups: string[]) => (await policy.handle({ permission }, user(groups))).result;

  it.each([
    ['admin', ADMIN, AuthorizeResult.ALLOW],
    ['instructor', ['group:default/instructors'], AuthorizeResult.ALLOW],
    ['engineer', ENGINEER, AuthorizeResult.DENY],
    ['lead', LEAD, AuthorizeResult.DENY],
    ['new hire', UNASSIGNED, AuthorizeResult.DENY],
  ])('manage (credentials, answer keys, handouts): %s', async (_role, groups, expected) => {
    expect(await decide(manage, groups)).toBe(expected);
  });

  it.each([
    ['engineer', ENGINEER],
    ['lead', LEAD],
    ['new hire (trainee)', UNASSIGNED],
  ])('enroll yourself: allowed for a %s', async (_role, groups) => {
    expect(await decide(enroll, groups)).toBe(AuthorizeResult.ALLOW);
  });
});
