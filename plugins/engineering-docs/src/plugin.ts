import {
  createPlugin,
  createRoutableExtension,
  createApiFactory,
  discoveryApiRef,
  identityApiRef,
} from '@backstage/core-plugin-api';
import { rootRouteRef } from './routes';
import { engineeringDocsApiRef, EngineeringDocsClient } from './api/EngineeringDocsClient';

export const engineeringDocsPlugin = createPlugin({
  id: 'engineering-docs',
  routes: { root: rootRouteRef },
  apis: [
    createApiFactory({
      api: engineeringDocsApiRef,
      deps: { discoveryApi: discoveryApiRef, identityApi: identityApiRef },
      factory: ({ discoveryApi, identityApi }) =>
        new EngineeringDocsClient(discoveryApi, identityApi),
    }),
  ],
});

export const EngineeringDocsPage = engineeringDocsPlugin.provide(
  createRoutableExtension({
    name: 'EngineeringDocsPage',
    component: () =>
      import('./components/EngineeringDocsPage').then(m => m.EngineeringDocsPage),
    mountPoint: rootRouteRef,
  }),
);
