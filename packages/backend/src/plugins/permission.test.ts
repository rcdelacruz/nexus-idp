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
    // User Management lets an admin make a trainee (no department team yet) an instructor.
    ['instructor who is only a trainee', ['group:default/general-engineers', 'group:default/instructors']],
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
    ['instructor who is only a trainee', ['group:default/general-engineers', 'group:default/instructors'], AuthorizeResult.ALLOW],
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

/**
 * Security regressions (2026-11-07 audit): who counts as admin, and who may use the Kubernetes proxy.
 */
describe('CatalogPermissionPolicy — admin identity and the Kubernetes proxy', () => {
  const policy = new CatalogPermissionPolicy();
  const decide = async (name: string, groups: string[]) =>
    (await policy.handle({ permission: createPermission({ name, attributes: {} }) }, user(groups))).result;

  it('a group called "admins" does not make anyone an admin (only backstage-admins does)', async () => {
    expect(await decide('catalog.entity.delete', ['group:default/admins'])).toBe(AuthorizeResult.DENY);
    expect(await decide('kubernetes.proxy', ['group:default/admins'])).toBe(AuthorizeResult.DENY);
    expect(await decide('catalog.entity.delete', ADMIN)).toBe(AuthorizeResult.ALLOW);
  });

  it.each([
    ['engineer', ENGINEER],
    ['lead', LEAD],
    ['unassigned', UNASSIGNED],
  ])('%s cannot use the Kubernetes proxy (it carries the portal pod\'s cluster-wide rights)', async (_r, groups) => {
    expect(await decide('kubernetes.proxy', groups)).toBe(AuthorizeResult.DENY);
  });

  it('an admin can', async () => {
    expect(await decide('kubernetes.proxy', ADMIN)).toBe(AuthorizeResult.ALLOW);
  });

  it('engineers still read clusters and workloads in the Kubernetes tab', async () => {
    expect(await decide('kubernetes.clusters.read', ENGINEER)).toBe(AuthorizeResult.ALLOW);
    expect(await decide('kubernetes.resources.read', ENGINEER)).toBe(AuthorizeResult.ALLOW);
  });
});

describe('CatalogPermissionPolicy — scaffolder dry-run', () => {
  const policy = new CatalogPermissionPolicy();
  const decide = async (name: string, groups: string[]) => (await policy.handle({ permission: createPermission({ name, attributes: {} }) }, user(groups))).result;

  it.each([
    ['engineer', ENGINEER],
    ['lead', LEAD],
    ['unassigned', UNASSIGNED],
  ])('%s cannot dry-run an inline template (it reads files with the portal\'s own credentials)', async (_r, groups) => {
    expect(await decide('scaffolder.template.dry-run', groups)).toBe(AuthorizeResult.DENY);
  });

  it('an admin can', async () => {
    expect(await decide('scaffolder.template.dry-run', ADMIN)).toBe(AuthorizeResult.ALLOW);
  });

  it('engineers and leads still run templates, and only leads manage them', async () => {
    expect(await decide('scaffolder.task.create', ENGINEER)).toBe(AuthorizeResult.ALLOW);
    expect(await decide('scaffolder.action.execute', LEAD)).toBe(AuthorizeResult.ALLOW);
    expect(await decide('scaffolder.template.update', ENGINEER)).toBe(AuthorizeResult.DENY);
    expect(await decide('scaffolder.template.update', LEAD)).toBe(AuthorizeResult.ALLOW);
  });
});

/**
 * Scaffolder tasks are visible and cancellable by their owner only (audit 2026-11-07): `.read` and `.cancel` used to be plain ALLOWs
 * for everyone, so anyone could list everyone's tasks and any engineer could cancel a lead's running teardown.
 */
describe('CatalogPermissionPolicy — scaffolder task read and cancel', () => {
  const policy = new CatalogPermissionPolicy();
  const resourcePermission = (name: string, action: 'read' | 'update') => createPermission({ name, attributes: { action }, resourceType: 'scaffolder-task' });
  const read = resourcePermission('scaffolder.task.read', 'read');
  const cancel = resourcePermission('scaffolder.task.cancel', 'update');
  const handle = (permission: any, groups: string[]) => policy.handle({ permission }, user(groups));

  it.each([
    ['unassigned', UNASSIGNED],
    ['engineer', ENGINEER],
    ['lead', LEAD],
  ])('%s gets a conditional decision limited to their own user ref, for read and for cancel', async (_r, groups) => {
    for (const permission of [read, cancel]) {
      const decision: any = await handle(permission, groups);
      expect(decision.result).toBe(AuthorizeResult.CONDITIONAL);
      expect(decision.pluginId).toBe('scaffolder');
      expect(decision.resourceType).toBe('scaffolder-task');
      expect(decision.conditions).toEqual({ rule: 'IS_TASK_OWNER', resourceType: 'scaffolder-task', params: { createdBy: ['user:default/jane.doe'] } });
    }
  });

  it('an admin sees and cancels every task', async () => {
    expect((await handle(read, ADMIN)).result).toBe(AuthorizeResult.ALLOW);
    expect((await handle(cancel, ADMIN)).result).toBe(AuthorizeResult.ALLOW);
  });

  it('is refused when the permission is not the scaffolder-task resource permission it claims to be', async () => {
    const basic = createPermission({ name: 'scaffolder.task.read', attributes: { action: 'read' } });
    expect((await handle(basic, ENGINEER)).result).toBe(AuthorizeResult.DENY);
  });

  it('creating and running tasks is unchanged', async () => {
    expect((await handle(createPermission({ name: 'scaffolder.task.create', attributes: {} }), ENGINEER)).result).toBe(AuthorizeResult.ALLOW);
    expect((await handle(createPermission({ name: 'scaffolder.action.execute', attributes: {} }), UNASSIGNED)).result).not.toBe(AuthorizeResult.CONDITIONAL);
  });
});


/**
 * A project manager's catalog visibility includes the teams of the projects they created. The registration API now only accepts
 * the seven teams of its form; rows written before that check can hold any text, so the policy filters as well (audit 2026-11-07:
 * a project with team_name `devops-team` let its project manager read everything devops-team owns).
 */
describe('project teams that grant a project manager catalog visibility', () => {
  const { catalogEntityReadPermission } = jest.requireActual('@backstage/plugin-catalog-common/alpha');
  const claimsOf = (decision: any): string[] => {
    const found: string[] = [];
    const walk = (n: any) => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n.claims)) found.push(...n.claims);
      Object.values(n).forEach(walk);
    };
    walk(decision.conditions);
    return found;
  };

  /** Just enough of a query builder for `db(table).select().where().whereNotNull().where()`, applying the filters it is given. */
  const fakeDb = (rows: Array<Record<string, any>>) => (_table: string) => {
    const filters: Array<(r: Record<string, any>) => boolean> = [];
    const q: any = {
      select: () => q,
      where: (column: string, value: unknown) => {
        filters.push(r => r[column] === value);
        return q;
      },
      whereNotNull: (column: string) => {
        filters.push(r => r[column] !== null && r[column] !== undefined);
        return q;
      },
      then: (resolve: (v: unknown) => void) => resolve(rows.filter(r => filters.every(f => f(r)))),
    };
    return q;
  };

  it('uses only the teams a project can have; any other stored text grants nothing', async () => {
    const db = fakeDb([
      { created_by: 'user:default/pm.one', team_name: 'web-team', status: 'active' },
      { created_by: 'user:default/pm.one', team_name: 'devops-team', status: 'active' },
      { created_by: 'user:default/pm.one', team_name: 'backstage-admins', status: 'active' },
      { created_by: 'user:default/pm.one', team_name: 'sa-team', status: 'archived' },
      { created_by: 'user:default/someone.else', team_name: 'qa-team', status: 'active' },
    ]);
    const policy = new CatalogPermissionPolicy({ getClient: async () => db } as any);
    await new Promise(r => setTimeout(r, 20)); // the policy connects to the database in the background
    const decision: any = await policy.handle(
      { permission: catalogEntityReadPermission } as any,
      { info: { userEntityRef: 'user:default/pm.one', ownershipEntityRefs: ['group:default/pm-team'] } } as any,
    );
    const claims = claimsOf(decision);
    expect(claims).toContain('group:default/web-team');
    expect(claims).not.toContain('group:default/devops-team');
    expect(claims).not.toContain('group:default/backstage-admins');
    expect(claims).not.toContain('group:default/sa-team'); // archived project
    expect(claims).not.toContain('group:default/qa-team'); // someone else's project
  });
});
