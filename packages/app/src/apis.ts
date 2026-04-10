import React from 'react';
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
  fetchApiRef,
  identityApiRef,
  oauthRequestApiRef,
  googleAuthApiRef,
} from '@backstage/core-plugin-api';
import { apiDocsConfigRef, defaultDefinitionWidgets, OpenApiDefinitionWidget } from '@backstage/plugin-api-docs';
import { userManagementApiRef, UserManagementApiImpl } from '@internal/plugin-user-management';
import { OAuth2, createFetchApi, FetchMiddlewares } from '@backstage/core-app-api';
import { techRadarApiRef } from '@backstage-community/plugin-tech-radar';
import { ThoughtworksTechRadarApi } from './components/techRadar/ThoughtworksTechRadarApi';
import { githubActionsApiRef, GithubActionsClient } from '@backstage-community/plugin-github-actions';
import { Octokit } from '@octokit/rest';
import { catalogImportApiRef, CatalogImportClient } from '@backstage/plugin-catalog-import';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { scmAuthApiRef } from '@backstage/integration-react';

export const apis: AnyApiFactory[] = [
  // Extends the default Backstage FetchApi with token injection + revoked-session auto sign-out.
  // createFetchApi + FetchMiddlewares.injectIdentityAuth replicates Backstage's built-in
  // auth header injection so the Bearer token is attached to all backend requests.
  createApiFactory({
    api: fetchApiRef,
    deps: { identityApi: identityApiRef, configApi: configApiRef, discoveryApi: discoveryApiRef },
    factory: ({ identityApi, configApi, discoveryApi }) => {
      const baseFetchApi = createFetchApi({
        middleware: [
          FetchMiddlewares.resolvePluginProtocol({ discoveryApi }),
          FetchMiddlewares.injectIdentityAuth({ identityApi, config: configApi }),
        ],
      });
      return {
        fetch: async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          const response = await baseFetchApi.fetch(input, init);
          if (response.status === 401) {
            try {
              const data = await response.clone().json() as { error?: string };
              if (typeof data?.error === 'string' && data.error.includes('revoked')) {
                await identityApi.signOut();
              }
            } catch {
              // Non-JSON 401 — not a revocation, leave it to the caller.
            }
          }
          return response;
        },
      };
    },
  }),
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
  createApiFactory({
    api: userManagementApiRef,
    deps: { discoveryApi: discoveryApiRef, identityApi: identityApiRef },
    factory: ({ discoveryApi, identityApi }) => new UserManagementApiImpl(discoveryApi, identityApi),
  }),
  createApiFactory({
    api: catalogImportApiRef,
    deps: {
      discoveryApi: discoveryApiRef,
      fetchApi: fetchApiRef,
      scmAuthApi: scmAuthApiRef,
      scmIntegrationsApi: scmIntegrationsApiRef,
      catalogApi: catalogApiRef,
      configApi: configApiRef,
    },
    factory: ({ discoveryApi, fetchApi, scmAuthApi, scmIntegrationsApi, catalogApi, configApi }) =>
      new CatalogImportClient({ discoveryApi, fetchApi, scmAuthApi, scmIntegrationsApi, catalogApi, configApi }),
  }),
  // Override apiDocsConfig to route SwaggerUI "Try it out" requests through the
  // Backstage CORS proxy backend, avoiding browser cross-origin restrictions.
  createApiFactory({
    api: apiDocsConfigRef,
    deps: { configApi: configApiRef },
    factory: ({ configApi }) => {
      const widgets = defaultDefinitionWidgets();
      // Compute proxy base URL synchronously from config — avoids async failures in the interceptor.
      const backendUrl = configApi.getString('backend.baseUrl');
      const proxyBase = `${backendUrl}/api/cors-proxy`;
      return {
        getApiDefinitionWidget: (entity: any) => {
          const widget = widgets.find((w: any) => w.type === entity.spec?.type);
          if (!widget || widget.type !== 'openapi') return widget;

          return {
            ...widget,
            component: (definition: string) =>
              React.createElement(OpenApiDefinitionWidget, {
                definition,
                requestInterceptor: (req: any) => {
                  try {
                    const reqUrl = new URL(req.url);
                    // Only proxy requests to a different origin
                    if (reqUrl.origin === window.location.origin) return req;
                    req.url = `${proxyBase}/forward?url=${encodeURIComponent(req.url)}`;
                  } catch {
                    // URL parsing failed, pass through unchanged
                  }
                  return req;
                },
              }),
          };
        },
      };
    },
  }),
];
