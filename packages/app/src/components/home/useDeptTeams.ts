import { useEffect, useState } from 'react';
import { useApi, identityApiRef } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { DEPT_TEAM_IDS_JWT } from '@internal/plugin-onboarding';

/**
 * Teams that get persona tiles: the onboarding dept teams, plus devops-team (exists in
 * stratpoint/org/groups.yaml but isn't an onboarding choice) and sre-team (not created yet).
 */
export const PERSONA_TEAMS: ReadonlyArray<string> = [...DEPT_TEAM_IDS_JWT, 'devops-team', 'sre-team'];

/**
 * Map a group name to the persona team it belongs to: `web-team` → `web-team`, `web-lead` → `web-team`.
 * Returns undefined for other groups (general-engineers, backstage-admins, design-team, ...).
 */
export const deptTeamFor = (group: string): string | undefined => {
  if (PERSONA_TEAMS.includes(group)) return group;
  const asTeam = group.replace(/-lead$/, '-team');
  return asTeam !== group && PERSONA_TEAMS.includes(asTeam) ? asTeam : undefined;
};

/**
 * Resolve the signed-in user's persona teams (plus `backstage-admins`), in PERSONA_TEAMS order.
 *
 * Same dual-source check as useUserRole in Root.tsx: JWT ownershipEntityRefs (accurate after a
 * fresh login) OR the catalog user entity's spec.memberOf (accurate ~60s after a team change,
 * while the JWT is still stale). A user can be in several teams, so all matches are returned.
 */
export const useDeptTeams = (): { teams: string[]; loading: boolean } => {
  const identityApi = useApi(identityApiRef);
  const catalogApi = useApi(catalogApiRef);
  const [state, setState] = useState<{ teams: string[]; loading: boolean }>({ teams: [], loading: true });

  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      try {
        const identity = await identityApi.getBackstageIdentity();
        const jwtGroups = identity.ownershipEntityRefs
          .filter(ref => ref.startsWith('group:default/'))
          .map(ref => ref.replace('group:default/', ''));
        const entity = await catalogApi.getEntityByRef(identity.userEntityRef).catch(() => undefined);
        const memberOf = (Array.isArray(entity?.spec?.memberOf) ? entity!.spec!.memberOf : []) as string[];

        const groups = new Set([...jwtGroups, ...memberOf]);
        const found = new Set<string>();
        groups.forEach(group => {
          const team = deptTeamFor(group);
          if (team) found.add(team);
        });
        const teams: string[] = PERSONA_TEAMS.filter(t => found.has(t));
        if (groups.has('backstage-admins')) teams.push('backstage-admins');
        if (!cancelled) setState({ teams, loading: false });
      } catch {
        if (!cancelled) setState({ teams: [], loading: false });
      }
    };
    resolve();
    return () => {
      cancelled = true;
    };
  }, [identityApi, catalogApi]);

  return state;
};
