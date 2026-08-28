import { Entity } from '@backstage/catalog-model';
import { isTaskCreationAllowed } from './scaffolderTaskGuard';

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
