import React, { useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useRouteRef, useApp } from '@backstage/core-plugin-api';
import { useColors } from '@stratpoint/theme-utils';
import {
  Page,
  Header,
  Content,
  ContentHeader,
  SupportButton,
} from '@backstage/core-components';
import {
  EntityListProvider,
  CatalogFilterLayout,
  EntitySearchBar,
  EntityKindPicker,
  UserListPicker,
  EntityTagPicker,
  EntityOwnerPicker,
} from '@backstage/plugin-catalog-react';
import {
  ScaffolderPageContextMenu,
  TemplateCategoryPicker,
  TemplateGroups,
} from '@backstage/plugin-scaffolder-react/alpha';
import { scaffolderPlugin } from '@backstage/plugin-scaffolder';
import { Grid } from '@material-ui/core';
import { parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import { buildTechDocsURL } from '@backstage/plugin-techdocs-react';
import {
  TECHDOCS_ANNOTATION,
  TECHDOCS_EXTERNAL_ANNOTATION,
} from '@backstage/plugin-techdocs-common';

interface Props {
  TemplateCardComponent?: React.ComponentType<any>;
  groups?: { title: string; filter: (e: any) => boolean }[];
  templateFilter?: (e: any) => boolean;
  headerOptions?: Record<string, any>;
  contextMenu?: {
    editor?: boolean;
    actions?: boolean;
    tasks?: boolean;
    templatingExtensions?: boolean;
  };
}

export const CustomScaffolderListPage = (props: Props) => {
  const c = useColors();
  const {
    TemplateCardComponent,
    groups: givenGroups = [],
    templateFilter,
    headerOptions,
    contextMenu,
  } = props;

  const navigate = useNavigate();
  const location = useLocation();
  const app = useApp();

  // Training templates are hidden from casual browsing here — only reachable via the
  // Local Provisioner page's "Provision resource" link, which appends this flag.
  const trainingAccess =
    new URLSearchParams(location.search).get('trainingAccess') === '1';
  const effectiveTemplateFilter = useCallback(
    (e: any) => {
      if (templateFilter && !templateFilter(e)) return false;
      const tags: string[] = e?.metadata?.tags ?? [];
      const isTraining = e?.spec?.type === 'training' || tags.includes('training');
      if (isTraining && !trainingAccess) return false;
      // Destructive templates (teardown-app) are never browsable here — the only
      // entry point is the entity page's Danger Zone card, which links straight
      // to the wizard, bypassing this list entirely. No access flag/bypass exists,
      // unlike training — there is no legitimate reason to browse into this.
      if (tags.includes('destructive')) return false;
      return true;
    },
    [templateFilter, trainingAccess],
  );

  const registerComponentLink = useRouteRef(
    scaffolderPlugin.externalRoutes.registerComponent,
  );
  const editorLink = useRouteRef(scaffolderPlugin.routes.edit as any);
  const actionsLink = useRouteRef(scaffolderPlugin.routes.actions);
  const tasksLink = useRouteRef(scaffolderPlugin.routes.listTasks);
  const viewTechDocsLink = useRouteRef(
    scaffolderPlugin.externalRoutes.viewTechDoc,
  );
  const templateRoute = useRouteRef(scaffolderPlugin.routes.selectedTemplate);
  const templatingExtensionsLink = useRouteRef(
    scaffolderPlugin.routes.templatingExtensions as any,
  );

  const groups =
    givenGroups.length > 0
      ? [
          ...givenGroups,
          {
            title: 'Other Templates',
            filter: (e: any) =>
              ![...givenGroups].some(({ filter }) => filter(e)),
          },
        ]
      : [{ title: 'Available Templates', filter: () => true }];

  const scaffolderPageContextMenuProps = {
    onEditorClicked:
      contextMenu?.editor !== false && editorLink
        ? () => navigate(editorLink())
        : undefined,
    onActionsClicked:
      contextMenu?.actions !== false && actionsLink
        ? () => navigate(actionsLink())
        : undefined,
    onTasksClicked:
      contextMenu?.tasks !== false && tasksLink
        ? () => navigate(tasksLink())
        : undefined,
    onTemplatingExtensionsClicked:
      contextMenu?.templatingExtensions !== false && templatingExtensionsLink
        ? () => navigate(templatingExtensionsLink())
        : undefined,
  };

  const additionalLinksForEntity = useCallback(
    (template: any) => {
      if (
        !(
          template.metadata.annotations?.[TECHDOCS_ANNOTATION] ||
          template.metadata.annotations?.[TECHDOCS_EXTERNAL_ANNOTATION]
        ) ||
        !viewTechDocsLink
      ) {
        return [];
      }
      const url = buildTechDocsURL(template, viewTechDocsLink);
      return url
        ? [{ icon: app.getSystemIcon('docs')!, text: 'View TechDocs', url }]
        : [];
    },
    [app, viewTechDocsLink],
  );

  const onTemplateSelected = useCallback(
    (template: any) => {
      const { namespace, name } = parseEntityRef(stringifyEntityRef(template));
      navigate(templateRoute({ namespace, templateName: name }));
    },
    [navigate, templateRoute],
  );

  return (
    <EntityListProvider>
      <Page themeId="home">
        <Header
          pageTitleOverride="Create a New Component"
          title="Create a New Component"
          subtitle="Create new software components using standard templates"
          {...headerOptions}
        >
          <ScaffolderPageContextMenu {...scaffolderPageContextMenuProps} />
        </Header>
        <Content>
          <ContentHeader title="">
            {registerComponentLink && (
              <a
                href={registerComponentLink()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: `1px solid ${c.border}`,
                  fontSize: '0.8125rem',
                  fontWeight: 500,
                  color: c.text,
                  textDecoration: 'none',
                  background: 'transparent',
                }}
              >
                Register Existing Component
              </a>
            )}
            <SupportButton>Browse available templates below</SupportButton>
          </ContentHeader>
          <CatalogFilterLayout>
            <CatalogFilterLayout.Filters options={{ drawerBreakpoint: 'xl' }}>
              <EntitySearchBar />
              <EntityKindPicker initialFilter="template" hidden />
              <UserListPicker
                initialFilter="all"
                availableFilters={['all', 'starred']}
              />
              <TemplateCategoryPicker />
              <EntityTagPicker />
              <EntityOwnerPicker />
            </CatalogFilterLayout.Filters>
            <Grid item xs={12}>
              <TemplateGroups
                groups={groups}
                templateFilter={effectiveTemplateFilter}
                TemplateCardComponent={TemplateCardComponent}
                onTemplateSelected={onTemplateSelected}
                additionalLinksForEntity={additionalLinksForEntity}
              />
            </Grid>
          </CatalogFilterLayout>
        </Content>
      </Page>
    </EntityListProvider>
  );
};
