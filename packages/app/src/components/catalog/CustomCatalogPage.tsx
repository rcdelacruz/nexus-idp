import React, { useEffect } from 'react';
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
  useEntityList,
} from '@backstage/plugin-catalog-react';
import { CatalogTable, catalogPlugin } from '@backstage/plugin-catalog';
import { catalogEntityCreatePermission } from '@backstage/plugin-catalog-common/alpha';
import { usePermission } from '@backstage/plugin-permission-react';

// Hides local-provisioning training entities (tagged both `training` and
// `local-provisioning`, and Templates with spec.type 'training') from the general catalog
// browse list. These are only meant to be reached via direct links from the Local
// Provisioner page, not casual browsing — see catalog-entity-visibility plan.
// NOTE: intentionally requires BOTH tags, not just `training` alone — the pre-existing,
// unrelated Kafka Training docs component (stratpoint/components/kafka-training-docs.yaml)
// is also tagged `training` and must stay visible in the main catalog.
const HideTrainingFilter = () => {
  const { updateFilters } = useEntityList();
  useEffect(() => {
    updateFilters({
      trainingExclude: {
        filterEntity: (entity: any) => {
          const tags: string[] = entity.metadata?.tags ?? [];
          const isLocalProvisioningTraining =
            tags.includes('training') && tags.includes('local-provisioning');
          const isTrainingTemplate =
            entity.kind === 'Template' && entity.spec?.type === 'training';
          return !(isLocalProvisioningTraining || isTrainingTemplate);
        },
      },
    } as any);
  }, [updateFilters]);
  return null;
};

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
          <HideTrainingFilter />
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
