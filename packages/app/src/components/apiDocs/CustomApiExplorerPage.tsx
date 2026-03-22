import React from 'react';
import {
  PageWithHeader,
  Content,
  ContentHeader,
  CreateButton,
  SupportButton,
} from '@backstage/core-components';
import { useApi, configApiRef, useRouteRef } from '@backstage/core-plugin-api';
import { Grid } from '@material-ui/core';
import {
  EntityListProvider,
  CatalogFilterLayout,
  EntityKindPicker,
  EntityTypePicker,
  UserListPicker,
  EntityOwnerPicker,
  EntityLifecyclePicker,
  EntityTagPicker,
} from '@backstage/plugin-catalog-react';
import { CatalogTable } from '@backstage/plugin-catalog';
import { apiDocsPlugin } from '@backstage/plugin-api-docs';
import { catalogEntityCreatePermission } from '@backstage/plugin-catalog-common/alpha';
import { usePermission } from '@backstage/plugin-permission-react';

const defaultColumns = [
  CatalogTable.columns.createTitleColumn({ hidden: true }),
  CatalogTable.columns.createNameColumn({ defaultKind: 'API' }),
  CatalogTable.columns.createSystemColumn(),
  CatalogTable.columns.createOwnerColumn(),
  CatalogTable.columns.createSpecTypeColumn(),
  CatalogTable.columns.createSpecLifecycleColumn(),
  CatalogTable.columns.createMetadataDescriptionColumn(),
  CatalogTable.columns.createTagsColumn(),
];

export const CustomApiExplorerPage = () => {
  const orgName =
    useApi(configApiRef).getOptionalString('organization.name') ?? 'Backstage';
  const registerComponentLink = useRouteRef(apiDocsPlugin.externalRoutes.registerApi);
  const { allowed } = usePermission({ permission: catalogEntityCreatePermission });

  return (
    <PageWithHeader
      themeId="apis"
      title="APIs"
      subtitle={`All APIs in ${orgName}`}
      pageTitleOverride="APIs"
    >
      <Content>
        <ContentHeader title="">
          {allowed && (
            <CreateButton
              title="Register API"
              to={registerComponentLink ? registerComponentLink() : '/catalog-import'}
            />
          )}
          <SupportButton>All APIs in your organization</SupportButton>
        </ContentHeader>
        <EntityListProvider>
          <CatalogFilterLayout>
            <CatalogFilterLayout.Filters options={{ drawerBreakpoint: 'xl' }}>
              <EntityKindPicker initialFilter="api" hidden />
              <EntityTypePicker />
              <UserListPicker initialFilter="all" />
              <EntityOwnerPicker />
              <EntityLifecyclePicker />
              <EntityTagPicker />
            </CatalogFilterLayout.Filters>
            <Grid item xs={12}>
              <CatalogTable columns={defaultColumns} />
            </Grid>
          </CatalogFilterLayout>
        </EntityListProvider>
      </Content>
    </PageWithHeader>
  );
};
