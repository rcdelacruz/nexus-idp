import { Entity } from '@backstage/catalog-model';
import { bearerToken, canonicalTemplateRef, decideTaskCreation, isTaskCreationAllowed } from './scaffolderTaskGuard';

const ADMIN = ['group:default/backstage-admins'];
const DEVOPS = ['group:default/devops-team'];
const LEAD = ['group:default/web-team', 'group:default/web-lead'];
const ENGINEER = ['group:default/web-team'];
const UNASSIGNED = ['group:default/general-engineers'];

function template(overrides: Partial<Entity> = {}): Entity {
  return {
    apiVersion: 'scaffolder.backstage.io/v1beta3',
    kind: 'Template',
    metadata: { name: 'some-template', namespace: 'default' },
    spec: { type: 'service' },
    relations: [],
    ...overrides,
  };
}

function ownedByDevops(overrides: Partial<Entity> = {}): Entity {
  return template({
    relations: [{ type: 'ownedBy', targetRef: 'group:default/devops-team' }],
    ...overrides,
  });
}

describe('isTaskCreationAllowed', () => {
  it('allows admins to run anything, including devops-owned templates', () => {
    expect(isTaskCreationAllowed(ADMIN, ownedByDevops())).toBe(true);
  });

  it('allows devops to run anything, including devops-owned templates', () => {
    expect(isTaskCreationAllowed(DEVOPS, ownedByDevops())).toBe(true);
  });

  describe('leads', () => {
    it('denies devops-owned templates', () => {
      expect(isTaskCreationAllowed(LEAD, ownedByDevops())).toBe(false);
    });

    it('allows devops-owned governance templates (e.g. promote-app)', () => {
      expect(
        isTaskCreationAllowed(LEAD, ownedByDevops({ spec: { type: 'governance' } })),
      ).toBe(true);
    });

    it('allows non-devops-owned templates', () => {
      expect(isTaskCreationAllowed(LEAD, template())).toBe(true);
    });

    it('allows devops-owned training labs', () => {
      expect(
        isTaskCreationAllowed(LEAD, ownedByDevops({ spec: { type: 'training' } })),
      ).toBe(true);
    });
  });

  describe('assigned engineers', () => {
    it('denies devops-owned templates', () => {
      expect(isTaskCreationAllowed(ENGINEER, ownedByDevops())).toBe(false);
    });

    it('denies teardown-app outright, even if not devops-owned', () => {
      expect(
        isTaskCreationAllowed(ENGINEER, template({ metadata: { name: 'teardown-app', namespace: 'default' } })),
      ).toBe(false);
    });

    it('allows ordinary non-devops-owned templates', () => {
      expect(isTaskCreationAllowed(ENGINEER, template())).toBe(true);
    });

    it('denies governance-type templates that are also devops-owned (no lead exception for engineers)', () => {
      expect(
        isTaskCreationAllowed(ENGINEER, ownedByDevops({ spec: { type: 'governance' } })),
      ).toBe(false);
    });

    it('allows devops-owned training labs (Local Provisioner is for every engineer)', () => {
      for (const team of ['web', 'mobile', 'data', 'cloud', 'ai', 'qa', 'sa']) {
        expect(
          isTaskCreationAllowed([`group:default/${team}-team`], ownedByDevops({ spec: { type: 'training' } })),
        ).toBe(true);
      }
    });

    it('matches spec.type case-insensitively, like the catalog read rule', () => {
      expect(
        isTaskCreationAllowed(ENGINEER, ownedByDevops({ spec: { type: 'Training' } })),
      ).toBe(true);
    });

    it('still denies devops-owned infrastructure templates', () => {
      expect(
        isTaskCreationAllowed(ENGINEER, ownedByDevops({ spec: { type: 'infrastructure' } })),
      ).toBe(false);
    });
  });

  describe('unassigned / new users', () => {
    it('allows Template-kind entities with spec.type training', () => {
      expect(
        isTaskCreationAllowed(UNASSIGNED, template({ spec: { type: 'training' } })),
      ).toBe(true);
    });

    it('denies non-training templates', () => {
      expect(isTaskCreationAllowed(UNASSIGNED, template())).toBe(false);
    });

    it('allows devops-owned templates too, as long as spec.type is training (ownership only matters for leads/engineers)', () => {
      expect(
        isTaskCreationAllowed(UNASSIGNED, ownedByDevops({ spec: { type: 'training' } })),
      ).toBe(true);
    });

    it('denies non-Template kinds even if spec.type happens to be training', () => {
      expect(
        isTaskCreationAllowed(UNASSIGNED, template({ kind: 'Component', spec: { type: 'training' } })),
      ).toBe(false);
    });
  });

  it('denies groups matching none of the known roles (fail closed)', () => {
    expect(isTaskCreationAllowed([], template())).toBe(false);
  });
});

/**
 * The guard's whole decision for one request (audit 2026-11-07): it parsed the header with the exact string "Bearer ", looked up the raw
 * template string while the scaffolder parses it differently, let anything it could not parse through, and failed OPEN when the catalog
 * errored. The two lookups are injected, so each case asserts what was and was not looked up.
 */
describe('decideTaskCreation', () => {
  const teardown = template({ metadata: { name: 'teardown-app', namespace: 'default' } });
  const deps = (groups: string[] | undefined, found: Entity | undefined | Error = teardown) => {
    const resolveGroups = jest.fn(async () => groups);
    const getTemplate = jest.fn(async () => {
      if (found instanceof Error) throw found;
      return found;
    });
    return { resolveGroups, getTemplate };
  };
  const req = (body: unknown, authorization: string | undefined = 'Bearer tok') => ({ authorization, body });

  describe('bearerToken', () => {
    it.each([['Bearer abc', 'abc'], ['bearer abc', 'abc'], ['BEARER abc', 'abc'], ['Bearer   abc', 'abc']])('reads %j like the framework', (h, t) => {
      expect(bearerToken(h)).toBe(t);
    });
    it.each([undefined, '', 'Bearer', 'Basic abc', 'Bearer a b', 'Bearerabc'])('%j is not a bearer token', h => {
      expect(bearerToken(h)).toBeUndefined();
    });
  });

  describe('canonicalTemplateRef', () => {
    it('adds the kind and namespace the scaffolder adds', () => {
      expect(canonicalTemplateRef('teardown-app')).toBe('template:default/teardown-app');
      expect(canonicalTemplateRef('template:default/teardown-app')).toBe('template:default/teardown-app');
      expect(canonicalTemplateRef('Template:Default/Teardown-App')).toBe('template:default/teardown-app'); // the catalog lowercases names
    });
    it.each([undefined, null, 5, {}, { kind: 'template', name: 'x' }, ['template:default/x'], '', ':::'])('refuses %j', raw => {
      expect(canonicalTemplateRef(raw)).toBeUndefined();
    });
  });

  it('applies the engineer rule to a lowercase "bearer" header (it used to skip the guard)', async () => {
    const d = deps(ENGINEER);
    const out = await decideTaskCreation(req({ templateRef: 'template:default/teardown-app' }, 'bearer tok'), d);
    expect(out).toMatchObject({ allow: false, status: 403 });
    expect(d.resolveGroups).toHaveBeenCalledWith('tok');
  });

  it('applies the same rule to a kind-less reference, which the scaffolder also accepts (it used to throw in the guard and pass)', async () => {
    const d = deps(ENGINEER);
    expect(await decideTaskCreation(req({ templateRef: 'teardown-app' }), d)).toMatchObject({ allow: false, status: 403 });
    expect(d.getTemplate).toHaveBeenCalledWith('template:default/teardown-app', 'tok');
  });

  it.each([undefined, null, 7, { kind: 'template', name: 'teardown-app' }, ['template:default/teardown-app'], ''])(
    'refuses a malformed templateRef %j with 400 for a user (it used to pass)',
    async templateRef => {
      const d = deps(ENGINEER);
      expect(await decideTaskCreation(req({ templateRef }), d)).toMatchObject({ allow: false, status: 400 });
      expect(d.getTemplate).not.toHaveBeenCalled();
    },
  );

  it('fails CLOSED when the catalog errors (it used to fail open)', async () => {
    const d = deps(ENGINEER, new Error('catalog down'));
    expect(await decideTaskCreation(req({ templateRef: 'template:default/x' }), d)).toMatchObject({ allow: false, status: 503 });
  });

  it('refuses a string the entity-ref parser accepts leniently but the catalog does not know (403, nothing runs)', async () => {
    const d = deps(ENGINEER, undefined);
    expect(await decideTaskCreation(req({ templateRef: 'not a ref at all ::' }), d)).toMatchObject({ allow: false, status: 403 });
  });

  it('refuses a template that is not visible to the user', async () => {
    expect(await decideTaskCreation(req({ templateRef: 'template:default/x' }), deps(ENGINEER, undefined))).toMatchObject({ allow: false, status: 403 });
  });

  it('lets an engineer run an ordinary template and a lead run teardown-app', async () => {
    expect(await decideTaskCreation(req({ templateRef: 'template:default/x' }), deps(ENGINEER, template()))).toEqual({ allow: true });
    expect(await decideTaskCreation(req({ templateRef: 'template:default/teardown-app' }), deps(LEAD, teardown))).toEqual({ allow: true });
  });

  it('admins and devops are never held up by the catalog or a malformed reference', async () => {
    for (const groups of [ADMIN, DEVOPS]) {
      const d = deps(groups, new Error('catalog down'));
      expect(await decideTaskCreation(req({ templateRef: 5 }), d)).toEqual({ allow: true });
      expect(d.getTemplate).not.toHaveBeenCalled();
    }
  });

  it('defers to the framework for a request with no bearer token and for a token that is not a user session (the static script token)', async () => {
    const none = deps(ENGINEER);
    expect(await decideTaskCreation({ authorization: undefined, body: { templateRef: 'x' } }, none)).toEqual({ allow: true });
    expect(none.resolveGroups).not.toHaveBeenCalled();
    const service = deps(undefined);
    expect(await decideTaskCreation(req({ templateRef: 5 }), service)).toEqual({ allow: true });
    expect(service.getTemplate).not.toHaveBeenCalled();
  });
});
