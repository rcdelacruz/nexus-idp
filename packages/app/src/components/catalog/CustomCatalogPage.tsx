import React from 'react';
import {
  PageWithHeader,
  Content,
  ContentHeader,
  CreateButton,
  SupportButton,
} from '@backstage/core-components';
import {
  useApi,
  configApiRef,
  useRouteRef,
  createRoutableExtension,
} from '@backstage/core-plugin-api';
import { Grid } from '@material-ui/core';
import {
  EntityListProvider,
  CatalogFilterLayout,
  DefaultFilters,
} from '@backstage/plugin-catalog-react';
import { CatalogTable, catalogPlugin } from '@backstage/plugin-catalog';
import { catalogEntityCreatePermission } from '@backstage/plugin-catalog-common/alpha';
import { usePermission } from '@backstage/plugin-permission-react';

const CustomCatalogPageInner = () => {
  const orgName =
    useApi(configApiRef).getOptionalString('organization.name') ?? 'Backstage';
  const createComponentLink = useRouteRef(catalogPlugin.externalRoutes.createComponent);
  const { allowed } = usePermission({ permission: catalogEntityCreatePermission });

  return (
    <PageWithHeader title={`${orgName} Catalog`} themeId="home">
      <Content>
        <ContentHeader title="">
          {allowed && (
            <CreateButton
              title="Create"
              to={createComponentLink ? createComponentLink() : '/create'}
            />
          )}
          <SupportButton>All the software in your organization</SupportButton>
        </ContentHeader>
        <EntityListProvider>
          <CatalogFilterLayout>
            <CatalogFilterLayout.Filters options={{ drawerBreakpoint: 'xl' }}>
              <DefaultFilters />
            </CatalogFilterLayout.Filters>
            <Grid item xs={12}>
              <CatalogTable />
            </Grid>
          </CatalogFilterLayout>
        </EntityListProvider>
      </Content>
    </PageWithHeader>
  );
};

// Wrap as a routable extension so catalogPlugin.routes.catalogIndex
// gets properly bound to /catalog — same as CatalogIndexPage does internally.
export const CustomCatalogPage = catalogPlugin.provide(
  createRoutableExtension({
    name: 'CatalogIndexPage',
    component: () => Promise.resolve(CustomCatalogPageInner),
    mountPoint: catalogPlugin.routes.catalogIndex,
  }),
);
