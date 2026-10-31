import React, { PropsWithChildren } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { TestApiProvider } from '@backstage/test-utils';
import { identityApiRef } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { useDeptTeams } from './useDeptTeams';

const identity = (ownershipEntityRefs: string[]) => ({
  getBackstageIdentity: async () => ({
    type: 'user' as const,
    userEntityRef: 'user:default/jane.doe',
    ownershipEntityRefs,
  }),
});

const catalog = (memberOf: string[] | 'fail') => ({
  getEntityByRef: async () => {
    if (memberOf === 'fail') throw new Error('catalog down');
    return { apiVersion: 'backstage.io/v1alpha1', kind: 'User', metadata: { name: 'jane.doe' }, spec: { memberOf } };
  },
});

const run = async (jwtRefs: string[], memberOf: string[] | 'fail') => {
  const wrapper = ({ children }: PropsWithChildren<{}>) => (
    <TestApiProvider apis={[[identityApiRef, identity(jwtRefs)], [catalogApiRef, catalog(memberOf)]]}>
      {children}
    </TestApiProvider>
  );
  const { result } = renderHook(() => useDeptTeams(), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result.current.teams;
};

describe('useDeptTeams', () => {
  it('reads teams from the JWT', async () => {
    expect(await run(['user:default/jane.doe', 'group:default/data-team'], [])).toEqual(['data-team']);
  });

  it('falls back to catalog memberOf while the JWT is stale after a team change', async () => {
    expect(await run(['user:default/jane.doe', 'group:default/general-engineers'], ['general-engineers', 'cloud-team']))
      .toEqual(['cloud-team']);
  });

  it('merges both sources, maps leads to their team, keeps PERSONA_TEAMS order', async () => {
    expect(await run(['group:default/data-lead'], ['web-team', 'devops-team'])).toEqual(['web-team', 'data-team', 'devops-team']);
  });

  it('adds backstage-admins and still works when the catalog call fails', async () => {
    expect(await run(['group:default/backstage-admins', 'group:default/qa-team'], 'fail')).toEqual(['qa-team', 'backstage-admins']);
  });

  it('returns no teams for an unassigned user', async () => {
    expect(await run(['group:default/general-engineers'], ['general-engineers'])).toEqual([]);
  });
});
