import React from 'react';
import { Grid, List } from '@material-ui/core';
import { InfoCard, useSidebarPinState } from '@backstage/core-components';
import {
  UserSettingsIdentityCard,
  UserSettingsLanguageToggle,
  UserSettingsPinToggle,
  UserSettingsProfileCard,
} from '@backstage/plugin-user-settings';
import { ThemePicker } from './ThemePicker';

/** Backstage's Appearance card, with the theme strip replaced by the picture-based picker. */
const AppearanceCard = () => {
  const { isMobile } = useSidebarPinState();
  return (
    <InfoCard title="Appearance" variant="gridItem">
      <ThemePicker />
      <List dense style={{ marginTop: 16 }}>
        <UserSettingsLanguageToggle />
        {!isMobile && <UserSettingsPinToggle />}
      </List>
    </InfoCard>
  );
};

/** Settings → General: profile and identity side by side, the appearance picker full width below. */
export const GeneralTab = () => (
  <Grid container direction="row" spacing={3}>
    <Grid item xs={12} md={6}>
      <UserSettingsProfileCard />
    </Grid>
    <Grid item xs={12} md={6}>
      <UserSettingsIdentityCard />
    </Grid>
    <Grid item xs={12}>
      <AppearanceCard />
    </Grid>
  </Grid>
);
