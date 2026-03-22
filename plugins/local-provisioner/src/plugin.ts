import {
  createPlugin,
  createRoutableExtension,
  createApiFactory,
  discoveryApiRef,
  identityApiRef,
} from '@backstage/core-plugin-api';
import { rootRouteRef } from './routes';
import { LocalProvisionerClient, localProvisionerApiRef } from './api/LocalProvisionerClient';

export const localProvisionerPlugin = createPlugin({
  id: 'local-provisioner',
  routes: {
    root: rootRouteRef,
  },
  apis: [
    createApiFactory({
      api: localProvisionerApiRef,
      deps: {
        discoveryApi: discoveryApiRef,
        identityApi: identityApiRef,
      },
      factory: ({ discoveryApi, identityApi }) =>
        new LocalProvisionerClient({ discoveryApi, identityApi }),
    }),
  ],
});

export const LocalProvisionerPage = localProvisionerPlugin.provide(
  createRoutableExtension({
    name: 'LocalProvisionerPage',
    component: () =>
      import('./components/LocalProvisionerPage').then(m => m.LocalProvisionerPage),
    mountPoint: rootRouteRef,
  }),
);
