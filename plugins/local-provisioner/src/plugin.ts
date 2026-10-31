import {
  createPlugin,
  createRoutableExtension,
  createApiFactory,
  discoveryApiRef,
  identityApiRef,
} from '@backstage/core-plugin-api';
import { rootRouteRef, traineesRouteRef } from './routes';
import { LocalProvisionerClient, localProvisionerApiRef } from './api/LocalProvisionerClient';

export const localProvisionerPlugin = createPlugin({
  id: 'local-provisioner',
  routes: {
    root: rootRouteRef,
    trainees: traineesRouteRef,
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

/** Instructor view: every trainee's training environments with their repo activity (admins + instructors). */
export const TraineesPage = localProvisionerPlugin.provide(
  createRoutableExtension({
    name: 'TraineesPage',
    component: () => import('./components/TraineesPage').then(m => m.TraineesPage),
    mountPoint: traineesRouteRef,
  }),
);
