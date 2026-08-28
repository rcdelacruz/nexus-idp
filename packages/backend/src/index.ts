/*
 * Hi!
 *
 * Note that this is an EXAMPLE Backstage backend. Please check the README.
 *
 * Happy hacking!
 */

import { createBackend } from '@backstage/backend-defaults';
import { rootHttpRouterServiceFactory } from '@backstage/backend-defaults/rootHttpRouter';
import express from 'express';
import { fsUrlReaderServiceFactory } from './plugins/fsUrlReaderModule';
import { createScaffolderTaskGuard, SCAFFOLDER_TASKS_PATH } from './plugins/scaffolderTaskGuard';

const backend = createBackend();

// Register file:// URL reader for local dev skeleton loading
backend.add(fsUrlReaderServiceFactory);

// Overrides coreServices.rootHttpRouter so scaffolderTaskGuard runs BEFORE any plugin's
// own router (applyDefaults() is what mounts all plugin routes — anything registered on
// `app` before calling it is guaranteed, by construction, to run first). This is the real
// enforcement point for scaffolder.task.create restrictions that permission.ts CANNOT
// enforce — see the file-level comment in plugins/scaffolderTaskGuard.ts for why.
backend.add(
  rootHttpRouterServiceFactory({
    configure: ({ app, config, logger, applyDefaults }) => {
      // Scoped to exactly the one path — a global body-parser here would risk breaking any
      // webhook-style endpoint elsewhere in the app that needs the raw, unparsed body (e.g.
      // HMAC signature verification). express.json() is a no-op re-parse if a downstream
      // plugin router also parses JSON (body-parser skips already-parsed bodies).
      app.use(SCAFFOLDER_TASKS_PATH, express.json());
      app.use(SCAFFOLDER_TASKS_PATH, createScaffolderTaskGuard({ config, logger }));
      applyDefaults();
    },
  }),
);

backend.add(import('@backstage/plugin-app-backend'));
backend.add(import('@backstage/plugin-proxy-backend'));
backend.add(import('@backstage/plugin-scaffolder-backend'));
backend.add(import('@backstage/plugin-scaffolder-backend-module-github'));
backend.add(import('@backstage/plugin-scaffolder-backend-module-gitlab'));
// Custom scaffolder actions (stratpoint:local-provision)
backend.add(import('./plugins/scaffolder-actions-module'));
backend.add(import('@backstage/plugin-techdocs-backend'));

// notifications — background scaffolder tasks (e.g. teardown-app) that take minutes
// notify the user in-app on completion instead of requiring the tab to stay open
backend.add(import('@backstage/plugin-signals-backend'));
backend.add(import('@backstage/plugin-notifications-backend'));

// auth plugin
backend.add(import('@backstage/plugin-auth-backend'));
// Custom Google module: auto-provisions users in the configured allowed domain to general-engineers on first login
backend.add(import('./plugins/google-auto-provision'));
// Custom GitHub module: enforces a verified allowed-domain email on the GitHub account before sign-in
backend.add(import('./plugins/github-email-enforcement'));
// GitLab provider: link-only (signIn disabled) — powers the "Connect GitLab account" button
// used by trainees on the GitLab CI capstone track. No custom resolver needed since it never
// creates a Backstage session, unlike github/google above.
backend.add(import('@backstage/plugin-auth-backend-module-gitlab-provider'));

// catalog plugin
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(
  import('@backstage/plugin-catalog-backend-module-scaffolder-entity-model'),
);
// GitHub autodiscovery — scans org repos for catalog-info.yaml files
backend.add(import('@backstage/plugin-catalog-backend-module-github'));

// See https://backstage.io/docs/features/software-catalog/configuration#subscribing-to-catalog-errors
backend.add(import('@backstage/plugin-catalog-backend-module-logs'));

// permission plugin
backend.add(import('@backstage/plugin-permission-backend'));
// Custom permission policy with role-based access control
backend.add(import('./plugins/permission-backend-module'));

// search plugin
backend.add(import('@backstage/plugin-search-backend'));

// search engine
// See https://backstage.io/docs/features/search/search-engines
backend.add(import('@backstage/plugin-search-backend-module-pg'));

// search collators
backend.add(import('@backstage/plugin-search-backend-module-catalog'));
backend.add(import('@backstage/plugin-search-backend-module-techdocs'));

// kubernetes
backend.add(import('@backstage/plugin-kubernetes-backend'));

// argocd
backend.add(import('@roadiehq/backstage-plugin-argo-cd-backend'));

// sonarqube
backend.add(import('@backstage-community/plugin-sonarqube-backend'));

// engineering hub
backend.add(
  import('@stratpoint/plugin-engineering-docs-backend').then(m => ({ default: m.engineeringDocsPlugin }))
);

// finops
backend.add(
  import('@stratpoint/plugin-finops-backend').then(m => ({ default: m.finopsPlugin }))
);

// project registration
backend.add(
  import('@stratpoint/plugin-project-registration-backend').then(m => ({ default: m.projectRegistrationPlugin }))
);

// local provisioner
backend.add(
  import('@stratpoint/plugin-local-provisioner-backend').then(m => ({ default: m.localProvisionerPlugin }))
);
// local provisioner — catalog entity provider (provisioned resources appear in the catalog)
backend.add(
  import('@stratpoint/plugin-local-provisioner-backend').then(m => ({ default: m.localProvisionerCatalogModule }))
);

// cors proxy (enables SwaggerUI "Try it out" through server-side forwarding)
backend.add(import('./plugins/cors-proxy'));

// scaffolder targets API — exposes app-config targets for DeploymentTargetPicker field
backend.add(import('./plugins/scaffolderTargetsApi'));

// user management
backend.add(
  import('@stratpoint/plugin-user-management-backend').then(m => ({ default: m.userManagementPlugin }))
);

// dbaas — connect databases integration hub
backend.add(
  import('@stratpoint/plugin-dbaas-backend').then(m => ({ default: m.dbaasPlugin }))
);
backend.add(
  import('@stratpoint/plugin-dbaas-backend').then(m => ({ default: m.dbaasBackendCatalogModule }))
);
backend.add(
  import('@stratpoint/plugin-user-management-backend').then(m => ({ default: m.userManagementCatalogModule }))
);
backend.add(
  import('@stratpoint/plugin-user-management-backend').then(m => ({ default: m.sessionRevocationModule }))
);

backend.start();
