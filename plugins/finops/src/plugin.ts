import {
  createPlugin,
  createRoutableExtension,
  createApiFactory,
  discoveryApiRef,
  identityApiRef,
} from '@backstage/core-plugin-api';
import { rootRouteRef } from './routes';
import { finopsApiRef, FinOpsClient } from './api/FinOpsClient';

export const finopsPlugin = createPlugin({
  id: 'finops',
  routes: { root: rootRouteRef },
  apis: [
    createApiFactory({
      api: finopsApiRef,
      deps: { discoveryApi: discoveryApiRef, identityApi: identityApiRef },
      factory: ({ discoveryApi, identityApi }) => new FinOpsClient(discoveryApi, identityApi),
    }),
  ],
});

export const FinOpsPage = finopsPlugin.provide(
  createRoutableExtension({
    name: 'FinOpsPage',
    component: () => import('./components/FinOpsPage').then(m => m.FinOpsPage),
    mountPoint: rootRouteRef,
  }),
);
