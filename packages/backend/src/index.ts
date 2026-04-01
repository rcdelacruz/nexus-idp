/*
 * Hi!
 *
 * Note that this is an EXAMPLE Backstage backend. Please check the README.
 *
 * Happy hacking!
 */

import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

backend.add(import('@backstage/plugin-app-backend'));
backend.add(import('@backstage/plugin-proxy-backend'));
backend.add(import('@backstage/plugin-scaffolder-backend'));
backend.add(import('@backstage/plugin-scaffolder-backend-module-github'));
// Custom scaffolder actions (stratpoint:local-provision)
backend.add(import('./plugins/scaffolder-actions-module'));
backend.add(import('@backstage/plugin-techdocs-backend'));

// auth plugin
backend.add(import('@backstage/plugin-auth-backend'));
// Custom Google module: auto-provisions org users to general-engineers on first login
backend.add(import('./plugins/google-auto-provision'));
// Custom GitHub module: enforces verified org email on GitHub account before sign-in
backend.add(import('./plugins/github-email-enforcement'));

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

// local provisioner
backend.add(
  import('@stratpoint/plugin-local-provisioner-backend').then(m => ({ default: m.localProvisionerPlugin }))
);

// cors proxy (enables SwaggerUI "Try it out" through server-side forwarding)
backend.add(import('./plugins/cors-proxy'));

// user management
backend.add(
  import('@stratpoint/plugin-user-management-backend').then(m => ({ default: m.userManagementPlugin }))
);
backend.add(
  import('@stratpoint/plugin-user-management-backend').then(m => ({ default: m.userManagementCatalogModule }))
);
backend.add(
  import('@stratpoint/plugin-user-management-backend').then(m => ({ default: m.sessionRevocationModule }))
);

backend.start();
