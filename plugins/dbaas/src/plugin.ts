import {
  createPlugin,
  createApiFactory,
  createComponentExtension,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';
import { dbaasApiRef } from './api/DbaasApi';
import { DbaasClient } from './api/DbaasClient';

export const dbaasPlugin = createPlugin({
  id: 'dbaas',
  apis: [
    createApiFactory({
      api: dbaasApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
      factory: ({ discoveryApi, fetchApi }) => new DbaasClient(discoveryApi, fetchApi),
    }),
  ],
});

export const ConnectDatabasesPage = dbaasPlugin.provide(
  createComponentExtension({
    name: 'ConnectDatabasesPage',
    component: {
      lazy: () =>
        import('./components/ConnectDatabasesPage').then(m => m.ConnectDatabasesPage),
    },
  }),
);
