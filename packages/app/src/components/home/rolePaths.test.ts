import { DEVOPS_TEMPLATE_TEAMS, ROLE_TILES, tilesForTeams } from './rolePaths';
import { PERSONA_TEAMS, deptTeamFor } from './useDeptTeams';

describe('deptTeamFor', () => {
  it('maps a dept team to itself and a lead to their team', () => {
    expect(deptTeamFor('data-team')).toBe('data-team');
    expect(deptTeamFor('web-lead')).toBe('web-team');
  });

  it('recognises devops-team, which is a real group but not an onboarding choice', () => {
    expect(deptTeamFor('devops-team')).toBe('devops-team');
  });

  it('ignores groups that are not dept teams', () => {
    expect(deptTeamFor('general-engineers')).toBeUndefined();
    expect(deptTeamFor('backstage-admins')).toBeUndefined();
    expect(deptTeamFor('design-team')).toBeUndefined();
    expect(deptTeamFor('unknown-lead')).toBeUndefined();
  });
});

describe('tilesForTeams', () => {
  it('returns nothing for a user with no mapped team', () => {
    expect(tilesForTeams([])).toEqual([]);
    expect(tilesForTeams(['pm-team'])).toEqual([]);
  });

  it('merges several teams in order and de-duplicates by link', () => {
    const tiles = tilesForTeams(['web-team', 'data-team']);
    const links = tiles.map(t => t.to);
    expect(new Set(links).size).toBe(links.length);
    // web-team first; Local Resources (shared by both) appears once, at web-team's position
    expect(tiles[0]).toBe(ROLE_TILES['web-team'][0]);
    expect(links.filter(l => l === '/local-provisioner')).toHaveLength(1);
    expect(links).toContain('/connect-databases');
  });

  it('gives admins their own tiles', () => {
    expect(tilesForTeams(['backstage-admins']).length).toBeGreaterThan(0);
  });

  it('has no duplicate links inside any single team', () => {
    for (const [team, tiles] of Object.entries(ROLE_TILES)) {
      const links = tiles.map(t => t.to);
      expect({ team, unique: new Set(links).size }).toEqual({ team, unique: links.length });
    }
  });

  it('only gives devops-owned template tiles to teams whose RBAC can see them', () => {
    // infrastructure + governance templates are all devops-team-owned; permission.ts hides them
    // from engineers and leads, so for anyone else these tiles would open an empty list.
    const devopsOnly = [/filters%5Btype%5D=infrastructure/, /filters%5Btype%5D=governance/, /filters%5Btype%5D=training/];
    for (const [team, tiles] of Object.entries(ROLE_TILES)) {
      if (DEVOPS_TEMPLATE_TEAMS.includes(team)) continue;
      for (const t of tiles) {
        expect({ team, to: t.to, devopsOnly: devopsOnly.some(re => re.test(t.to)) }).toEqual({ team, to: t.to, devopsOnly: false });
      }
    }
  });

  it('gives every team except admins one AI tile, linking to a real nexus-dev docs section', () => {
    // anchors verified on https://nexus.coderstudio.co/docs (2026-10-30)
    const anchors = new Set(['day1', 'docs-folder', 'skills']);
    for (const [team, tiles] of Object.entries(ROLE_TILES)) {
      const ai = tiles.filter(t => t.to.startsWith('https://nexus.coderstudio.co/docs'));
      expect({ team, count: ai.length }).toEqual({ team, count: team === 'backstage-admins' ? 0 : 1 });
      for (const t of ai) expect(anchors).toContain(t.to.split('#')[1]);
    }
  });

  it('is keyed on real group names', () => {
    const known = new Set([...PERSONA_TEAMS, 'backstage-admins']);
    for (const team of Object.keys(ROLE_TILES)) {
      expect(known).toContain(team);
    }
  });
});
