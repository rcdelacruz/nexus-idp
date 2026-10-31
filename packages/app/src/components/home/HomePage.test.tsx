import React from 'react';
import { screen } from '@testing-library/react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { identityApiRef } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { HomePage } from './HomePage';

const renderFor = (groups: string[]) =>
  renderInTestApp(
    <TestApiProvider
      apis={[
        [identityApiRef, {
          getBackstageIdentity: async () => ({
            type: 'user',
            userEntityRef: 'user:default/jane.doe',
            ownershipEntityRefs: ['user:default/jane.doe', ...groups.map(g => `group:default/${g}`)],
          }),
        }],
        [catalogApiRef, {
          getEntities: async () => ({ items: [] }),
          getEntityByRef: async () => ({
            apiVersion: 'backstage.io/v1alpha1', kind: 'User', metadata: { name: 'jane.doe' }, spec: { memberOf: groups },
          }),
        }],
      ]}
    >
      <HomePage />
    </TestApiProvider>,
  );

describe('HomePage — For your team', () => {
  it('renders the team tiles, with the AI tile as an external new-tab link', async () => {
    await renderFor(['data-team']);

    expect(await screen.findByText('For your team')).toBeInTheDocument();

    const ai = screen.getByText('AI Database Review').closest('a')!;
    expect(ai).toHaveAttribute('href', 'https://nexus.coderstudio.co/docs#skills');
    expect(ai).toHaveAttribute('target', '_blank');
    expect(ai).toHaveAttribute('rel', 'noopener noreferrer');

    const internal = screen.getByText('Databases').closest('a')!;
    expect(internal).toHaveAttribute('href', '/connect-databases');
    expect(internal).not.toHaveAttribute('target');
  });

  it('renders merged cloud + admin tiles for a cloud-team admin', async () => {
    await renderFor(['cloud-team', 'backstage-admins']);
    expect(await screen.findByText('For your team')).toBeInTheDocument();
    expect(screen.getByText('AI Deployment Review')).toBeInTheDocument();
    expect(screen.getByText('Promote an App')).toBeInTheDocument();
  });

  it('shows no team section for a team without tiles', async () => {
    await renderFor(['pm-team']);
    expect(await screen.findByText('Platform')).toBeInTheDocument();
    expect(screen.queryByText('For your team')).not.toBeInTheDocument();
  });
});
