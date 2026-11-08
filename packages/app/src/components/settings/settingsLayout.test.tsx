import React from 'react';
import { Route } from 'react-router-dom';
import { screen } from '@testing-library/react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { AppThemeSelector, FlatRoutes } from '@backstage/core-app-api';
import { appThemeApiRef } from '@backstage/core-plugin-api';
import { catalogApiRef, entityRouteRef } from '@backstage/plugin-catalog-react';
import { UserSettingsPage } from '@backstage/plugin-user-settings';
import { PALETTES, THEME_IDS } from '@stratpoint/theme-utils';
import { settingsLayout } from './settingsLayout';

// The page as App.tsx mounts it (FlatRoutes is what App.tsx uses).
const page = (
  <FlatRoutes>
    <Route path="/settings" element={<UserSettingsPage />}>
      {settingsLayout}
    </Route>
  </FlatRoutes>
);

const themes = THEME_IDS.map(id => ({ id, title: PALETTES[id].name, variant: PALETTES[id].isDark ? 'dark' : 'light', Provider: () => null })) as any[];

const open = async (path: string) => {
  const selector = new AppThemeSelector(themes);
  selector.setActiveThemeId('dark');
  return renderInTestApp(
    <TestApiProvider apis={[[appThemeApiRef, selector], [catalogApiRef, { getEntityByRef: async () => undefined }]]}>{page}</TestApiProvider>,
    { routeEntries: [path], mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef } },
  );
};

describe('Settings page', () => {
  it('keeps every tab it had, in the same order', async () => {
    await open('/settings/general');
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual([
      'General',
      'Authentication Providers',
      'Feature Flags',
      'Connect Databases',
      'About',
    ]);
  });

  it('General shows the picture-based theme picker instead of Backstage\'s strip of buttons', async () => {
    await open('/settings/general');
    expect(await screen.findByText('Appearance')).toBeTruthy();
    // the picker: one radio per theme plus Auto, grouped
    expect(screen.getAllByRole('radio')).toHaveLength(THEME_IDS.length + 1);
    for (const group of ['Automatic', 'Light', 'Dark']) expect(screen.getByRole('group', { name: group })).toBeTruthy();
    // Backstage's own toggle strip is gone
    expect(screen.queryByText('Select Auto Theme')).toBeNull();
    expect(screen.queryByRole('button', { name: /Select Auto Theme/ })).toBeNull();
    // the other Appearance rows are still there, the profile and identity cards too
    expect(screen.getByText('Profile')).toBeTruthy();
  });
});
