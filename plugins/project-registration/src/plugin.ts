import { createPlugin, createRoutableExtension, createRouteRef } from '@backstage/core-plugin-api';

export const projectRegistrationPlugin = createPlugin({
  id: 'project-registration',
});

export const ProjectRegistrationPage = projectRegistrationPlugin.provide(
  createRoutableExtension({
    name: 'ProjectRegistrationPage',
    component: () =>
      import('./components/ProjectRegistrationPage').then(m => m.ProjectRegistrationPage),
    mountPoint: createRouteRef({
      id: 'project-registration',
    }),
  }),
);

export const ProjectListPage = projectRegistrationPlugin.provide(
  createRoutableExtension({
    name: 'ProjectListPage',
    component: () =>
      import('./components/ProjectListPage').then(m => m.ProjectListPage),
    mountPoint: createRouteRef({
      id: 'project-list',
    }),
  }),
);
