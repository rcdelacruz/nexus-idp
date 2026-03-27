import { createPlugin, createRoutableExtension } from '@backstage/core-plugin-api';
import { rootRouteRef } from './routes';

export const onboardingPlugin = createPlugin({
  id: 'onboarding',
  routes: { root: rootRouteRef },
});

export const OnboardingPage = onboardingPlugin.provide(
  createRoutableExtension({
    name: 'OnboardingPage',
    component: () => import('./components/OnboardingPage').then(m => m.OnboardingPage),
    mountPoint: rootRouteRef,
  }),
);
