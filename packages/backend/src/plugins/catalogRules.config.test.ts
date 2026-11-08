/**
 * Who may declare Groups and Users in the catalog. The permission policy trusts group membership (`backstage-admins`, `*-lead`,
 * department teams), and GitHub discovery reads `catalog-info.yaml` from the default branch of every repo in two orgs, repos
 * whose contributors include trainees. A Group or User allowed from any repo would let that contributor grant themselves a role.
 * (Audit 2026-11-07: the global rule allowed both, and a trainee repo could declare `Group admins`.)
 */
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

const read = (file: string) => yaml.parse(fs.readFileSync(path.resolve(__dirname, '../../../../', file), 'utf8'));
const kinds = (rule: any): string[] => (rule.allow ?? []).map((a: any) => (typeof a === 'string' ? a : a.kind));

describe.each(['app-config.yaml', 'app-config.production.yaml', 'app-config.on-prem.yaml'])('catalog rules in %s', file => {
  const cfg = read(file);

  it('the global rule does not allow Group or User from discovered locations', () => {
    for (const rule of cfg.catalog?.rules ?? []) {
      expect(kinds(rule)).not.toContain('Group');
      expect(kinds(rule)).not.toContain('User');
    }
  });

  it('the org root location is the one place that may declare Groups and Users, and it still can', () => {
    const locations: any[] = cfg.catalog?.locations ?? [];
    if (locations.length === 0) return; // this file adds no locations (the base file does)
    const root = locations.find(l => /example-org\/catalog-info\.yaml$/.test(l.target));
    expect(root).toBeDefined();
    const k = (root.rules as any[]).flatMap(kinds);
    expect(k).toEqual(expect.arrayContaining(['Group', 'User']));
  });

  it('only the org root location may declare them (not even the engineering-standards templates root)', () => {
    const allowed = (cfg.catalog?.locations ?? []).filter((l: any) => (l.rules ?? []).some((r: any) => kinds(r).some(k => k === 'Group' || k === 'User')));
    for (const l of allowed) {
      expect(l.target).toMatch(/(^|\/)example-org\/catalog-info\.yaml$/);
    }
  });
});

it('the base config still gives the org root the right to declare Groups and Users', () => {
  const loc = read('app-config.yaml').catalog.locations.find((l: any) => /example-org\/catalog-info\.yaml$/.test(l.target));
  const k = (loc.rules as any[]).flatMap(kinds);
  expect(k).toEqual(expect.arrayContaining(['Group', 'User']));
});
