import {
  ScmIntegrationsApi,
  scmIntegrationsApiRef,
  ScmAuth,
} from '@backstage/integration-react';
import {
  AnyApiFactory,
  configApiRef,
  createApiFactory,
  discoveryApiRef,
  oauthRequestApiRef,
  googleAuthApiRef,
} from '@backstage/core-plugin-api';
import { OAuth2 } from '@backstage/core-app-api';
import { techRadarApiRef } from '@backstage-community/plugin-tech-radar';
import { ThoughtworksTechRadarApi } from './components/techRadar/ThoughtworksTechRadarApi';

export const apis: AnyApiFactory[] = [
  createApiFactory({
    api: googleAuthApiRef,
    deps: {
      configApi: configApiRef,
      oauthRequestApi: oauthRequestApiRef,
      discoveryApi: discoveryApiRef,
    },
    factory: ({ configApi, oauthRequestApi, discoveryApi }) =>
      OAuth2.create({
        configApi,
        oauthRequestApi,
        discoveryApi,
        provider: {
          id: 'google',
          title: 'Google',
          icon: () => null,
        },
      }),
  }),
  createApiFactory({
    api: scmIntegrationsApiRef,
    deps: { configApi: configApiRef },
    factory: ({ configApi }) => ScmIntegrationsApi.fromConfig(configApi),
  }),
  ScmAuth.createDefaultApiFactory(),
  createApiFactory({
    api: techRadarApiRef,
    deps: {},
    factory: () => new ThoughtworksTechRadarApi(),
  }),
];
