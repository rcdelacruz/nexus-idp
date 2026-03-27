import React from 'react';
import { Route } from 'react-router-dom';
import { apiDocsPlugin } from '@backstage/plugin-api-docs';
import {
  CatalogEntityPage,
  catalogPlugin,
} from '@backstage/plugin-catalog';
import {
  CatalogImportPage,
  catalogImportPlugin,
} from '@backstage/plugin-catalog-import';
import { ScaffolderPage, scaffolderPlugin } from '@backstage/plugin-scaffolder';
import { orgPlugin } from '@backstage/plugin-org';
import { SearchPage } from '@backstage/plugin-search';
import { UserSettingsPage } from '@backstage/plugin-user-settings';
import { apis } from './apis';
import { entityPage } from './components/catalog/EntityPage';
import { CustomCatalogPage } from './components/catalog/CustomCatalogPage';
import { CustomApiExplorerPage } from './components/apiDocs/CustomApiExplorerPage';
import { searchPage } from './components/search/SearchPage';
import { HomePage } from './components/home';
import { CustomSignInPage } from './components/auth';
import { Root } from './components/Root';
import { CustomTechDocsPage } from './components/techdocs/CustomTechDocsPage';
import { TechDocsRedirect } from './components/techdocs/TechDocsRedirect';

import {
  AlertDisplay,
  OAuthRequestDialog,
} from '@backstage/core-components';
import { createApp } from '@backstage/app-defaults';
import { UnifiedThemeProvider } from '@backstage/theme';
import { stratpointDarkTheme, stratpointLightTheme } from './theme';
import DarkIcon from '@material-ui/icons/Brightness2';
import LightIcon from '@material-ui/icons/WbSunny';
import { AppRouter, FlatRoutes } from '@backstage/core-app-api';
import { CustomCatalogGraphPage } from './components/catalogGraph/CustomCatalogGraphPage';
import { RequirePermission } from '@backstage/plugin-permission-react';
import { catalogEntityCreatePermission } from '@backstage/plugin-catalog-common/alpha';
import { CustomTemplateCard } from './components/scaffolder/CustomTemplateCard';
import { CustomScaffolderListPage } from './components/scaffolder/CustomScaffolderListPage';
import { ProjectRegistrationPage } from '@internal/backstage-plugin-project-registration';
import { EngineeringDocsPage } from '@internal/plugin-engineering-docs';
import { FinOpsPage } from '@internal/plugin-finops';
import { CustomTechRadarPage } from './components/techRadar/CustomTechRadarPage';
import { LocalProvisionerPage } from '@internal/plugin-local-provisioner';
import { OnboardingPage } from '@internal/plugin-onboarding';
import { UserManagementPage } from '@internal/plugin-user-management';
import { DeviceAuthPage } from './components/DeviceAuthPage';
import { GlobalStyleOverrides } from './components/GlobalStyleOverrides';

const app = createApp({
  apis,
  themes: [
    {
      id: 'dark',
      title: 'Dark',
      variant: 'dark',
      icon: <DarkIcon />,
      Provider: ({ children }) => (
        <UnifiedThemeProvider theme={stratpointDarkTheme} children={children} />
      ),
    },
    {
      id: 'light',
      title: 'Light',
      variant: 'light',
      icon: <LightIcon />,
      Provider: ({ children }) => (
        <UnifiedThemeProvider theme={stratpointLightTheme} children={children} />
      ),
    },
  ],
  bindRoutes({ bind }) {
    bind(catalogPlugin.externalRoutes, {
      createComponent: scaffolderPlugin.routes.root,
      createFromTemplate: scaffolderPlugin.routes.selectedTemplate,
    });
    bind(apiDocsPlugin.externalRoutes, {
      registerApi: catalogImportPlugin.routes.importPage,
    });
    bind(scaffolderPlugin.externalRoutes, {
      registerComponent: catalogImportPlugin.routes.importPage,
    });
    bind(orgPlugin.externalRoutes, {
      catalogIndex: catalogPlugin.routes.catalogIndex,
    });
  },

  components: {
    SignInPage: props => {
      return <CustomSignInPage {...props} />;
    },
  },
});

const routes = (
  <FlatRoutes>
    <Route path="/device" element={<DeviceAuthPage />} />
    <Route path="/" element={<HomePage />} />
    <Route path="/catalog" element={<CustomCatalogPage />} />
    <Route
      path="/catalog/:namespace/:kind/:name"
      element={<CatalogEntityPage />}
    >
      {entityPage}
    </Route>
    <Route path="/docs" element={<CustomTechDocsPage />} />
    <Route
      path="/docs/:namespace/:kind/:name/*"
      element={<TechDocsRedirect />}
    />
    <Route path="/create" element={<ScaffolderPage components={{ TemplateCardComponent: CustomTemplateCard as any, EXPERIMENTAL_TemplateListPageComponent: (props: any) => <CustomScaffolderListPage {...props} TemplateCardComponent={CustomTemplateCard as any} /> }} />} />
    <Route path="/api-docs" element={<CustomApiExplorerPage />} />
    <Route
      path="/catalog-import"
      element={
        <RequirePermission permission={catalogEntityCreatePermission}>
          <CatalogImportPage />
        </RequirePermission>
      }
    />
    <Route path="/search" element={<SearchPage />}>
      {searchPage}
    </Route>
    <Route path="/settings" element={<UserSettingsPage />} />
    <Route path="/catalog-graph" element={<CustomCatalogGraphPage />} />
    <Route path="/project-registration" element={<ProjectRegistrationPage />} />
    <Route path="/engineering-docs" element={<EngineeringDocsPage />} />
    <Route path="/finops" element={<FinOpsPage />} />
    <Route path="/tech-radar" element={<CustomTechRadarPage />} />
    <Route path="/local-provisioner" element={<LocalProvisionerPage />} />
    <Route path="/onboarding" element={<OnboardingPage />} />
    <Route path="/user-management" element={<UserManagementPage />} />
  </FlatRoutes>
);

export default app.createRoot(
  <>
    <GlobalStyleOverrides />
    <AlertDisplay />
    <OAuthRequestDialog />
    <AppRouter>
      <Root>{routes}</Root>
    </AppRouter>
  </>,
);
