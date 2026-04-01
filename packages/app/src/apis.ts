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
import { githubActionsApiRef, GithubActionsClient } from '@backstage-community/plugin-github-actions';
import { Octokit } from '@octokit/rest';

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
  // Override GitHub Actions API to route through the Backstage proxy.
  // Users sign in via Google (not GitHub), so scmAuthApi has no GitHub token.
  // The /github/api proxy endpoint injects the server-side GITHUB_TOKEN.
  createApiFactory({
    api: githubActionsApiRef,
    deps: { configApi: configApiRef, discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
    factory: ({ configApi, discoveryApi, fetchApi }) => {
      const noopScmAuth = { getCredentials: async () => ({ token: '', headers: {} }) };
      const client = new GithubActionsClient({ configApi, scmAuthApi: noopScmAuth } as any);
      (client as any).getOctokit = async () => {
        const proxyUrl = await discoveryApi.getBaseUrl('proxy');
        return new Octokit({
          baseUrl: `${proxyUrl}/github/api`,
          request: { fetch: fetchApi.fetch },
        });
      };
      return client;
    },
  }),
  createApiFactory({
    api: techRadarApiRef,
    deps: {},
    factory: () => new ThoughtworksTechRadarApi(),
  }),
];
