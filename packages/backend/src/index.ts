/*
 * Hi!
 *
 * Note that this is an EXAMPLE Backstage backend. Please check the README.
 *
 * Happy hacking!
 */

import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();


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
backend.add(import('@backstage/plugin-auth-backend-module-google-provider'));
backend.add(import('@backstage/plugin-auth-backend-module-github-provider'));

// catalog plugin
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(
  import('@backstage/plugin-catalog-backend-module-scaffolder-entity-model'),
);

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

backend.start();
