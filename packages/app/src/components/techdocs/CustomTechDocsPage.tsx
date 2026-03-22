import React from 'react';
import {
  PageWithHeader,
  Content,
  ContentHeader,
  SupportButton,
} from '@backstage/core-components';
import { useApi, configApiRef, createRoutableExtension } from '@backstage/core-plugin-api';
import { Grid } from '@material-ui/core';
import {
  EntityListProvider,
  CatalogFilterLayout,
  UserListPicker,
  EntityOwnerPicker,
  EntityTagPicker,
} from '@backstage/plugin-catalog-react';
import { TechDocsPicker, EntityListDocsTable, techdocsPlugin } from '@backstage/plugin-techdocs';

const CustomTechDocsPageInner = () => {
  const orgName =
    useApi(configApiRef).getOptionalString('organization.name') ?? 'Backstage';

  return (
    <PageWithHeader
      title="Documentation"
      subtitle={`Documentation available in ${orgName}`}
      themeId="documentation"
    >
      <Content>
        <ContentHeader title="">
          <SupportButton>Discover documentation in your ecosystem.</SupportButton>
        </ContentHeader>
        <EntityListProvider>
          <CatalogFilterLayout>
            <CatalogFilterLayout.Filters options={{ drawerBreakpoint: 'xl' }}>
              <TechDocsPicker />
              <UserListPicker initialFilter="owned" />
              <EntityOwnerPicker />
              <EntityTagPicker />
            </CatalogFilterLayout.Filters>
            <Grid item xs={12}>
              <EntityListDocsTable />
            </Grid>
          </CatalogFilterLayout>
        </EntityListProvider>
      </Content>
    </PageWithHeader>
  );
};

// Wrap as routable extension so techdocs:index-page routeRef is properly bound.
// Same pattern as CustomCatalogPage — required for TechDocsReaderPageHeader
// to resolve the "Back to docs" link via useRouteRef(rootRouteRef).
export const CustomTechDocsPage = techdocsPlugin.provide(
  createRoutableExtension({
    name: 'TechDocsIndexPage',
    component: () => Promise.resolve(CustomTechDocsPageInner),
    mountPoint: (techdocsPlugin as any).routes.root,
  }),
);
