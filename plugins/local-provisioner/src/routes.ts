import { createRouteRef } from '@backstage/core-plugin-api';

export const rootRouteRef = createRouteRef({
  id: 'local-provisioner',
});

export const traineesRouteRef = createRouteRef({
  id: 'local-provisioner-trainees',
});
