import React from 'react';
import { SettingsLayout, UserSettingsAuthProviders, UserSettingsFeatureFlags } from '@backstage/plugin-user-settings';
import { ConnectDatabasesPage } from '@internal/plugin-dbaas';
import { AboutTab } from './AboutTab';
import { GeneralTab } from './GeneralTab';

/**
 * Settings page tabs: Backstage's own, with General swapped for ours (Appearance shows each theme as a picture),
 * plus Connect Databases and About. Backstage looks for this element among the children of the /settings route.
 */
export const settingsLayout = (
  <SettingsLayout>
    <SettingsLayout.Route path="general" title="General">
      <GeneralTab />
    </SettingsLayout.Route>
    <SettingsLayout.Route path="auth-providers" title="Authentication Providers">
      <UserSettingsAuthProviders />
    </SettingsLayout.Route>
    <SettingsLayout.Route path="feature-flags" title="Feature Flags">
      <UserSettingsFeatureFlags />
    </SettingsLayout.Route>
    <SettingsLayout.Route path="/connect-databases" title="Connect Databases">
      <ConnectDatabasesPage />
    </SettingsLayout.Route>
    <SettingsLayout.Route path="/about" title="About">
      <AboutTab />
    </SettingsLayout.Route>
  </SettingsLayout>
);
