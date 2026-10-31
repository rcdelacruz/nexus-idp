import type { ElementType } from 'react';
import {
  AppWindow, Boxes, Cloud, Database, Layers, Network, Rocket, ServerCog, ShieldAlert, Sparkles, Workflow,
} from 'lucide-react';

/**
 * "For your team" homepage tiles, per dept team.
 *
 * Pure data — edit here to change what each persona sees; HomePage.tsx only renders it.
 * Keys are real group names (PERSONA_TEAMS in useDeptTeams.ts, plus backstage-admins). A user in
 * several teams gets the tiles of all of them, merged in PERSONA_TEAMS order and de-duplicated by `to`.
 *
 * Template tiles must match RBAC (packages/backend/src/plugins/permission.ts): engineers and leads
 * can't see devops-team-owned templates — every infrastructure template, most service templates
 * and all training templates. Only devops-team and backstage-admins get those tiles; a tile that
 * opens an empty template list is worse than no tile.
 *
 * devops-team exists in stratpoint/org/groups.yaml but isn't an onboarding choice, and sre-team
 * doesn't exist yet.
 *
 * AI tiles link to the nexus-dev toolkit docs (external, opens in a new tab) — the section that
 * fits each role. Real-project engineers use Claude Code / Codex; trainees use OpenCode.
 */

export type RoleTile = {
  icon: ElementType;
  title: string;
  description: string;
  to: string;
};

const NEXUS_DOCS = 'https://nexus.coderstudio.co/docs';

const templates = (type: string) =>
  `/create?filters%5Bkind%5D=template&filters%5Btype%5D=${type}&filters%5Buser%5D=all`;

const tile = {
  appTemplates: {
    icon: AppWindow,
    title: 'Application Templates',
    description: 'Start a new app from a golden-path template — repo, CI and catalog entry included.',
    to: templates('application'),
  },
  serviceTemplates: {
    icon: Rocket,
    title: 'Deploy a Service',
    description: 'Deploy an app with the service templates available to your team.',
    to: templates('service'),
  },
  infraTemplates: {
    icon: Cloud,
    title: 'Infrastructure Templates',
    description: 'Provision EC2, ECS, EKS, RDS or a Kubernetes namespace with OpenTofu.',
    to: templates('infrastructure'),
  },
  governanceTemplates: {
    icon: ShieldAlert,
    title: 'Promote an App',
    description: 'Promote an app between environments. Teardown lives in each entity’s Danger Zone.',
    to: templates('governance'),
  },
  services: {
    icon: ServerCog,
    title: 'Services & Monitoring',
    description: 'Running services — open one for its ArgoCD, Kubernetes and Monitoring tabs and runbook links.',
    to: '/catalog?filters%5Bkind%5D=component&filters%5Btype%5D=service',
  },
  databases: {
    icon: Database,
    title: 'Databases',
    description: 'Connect and manage databases for your projects.',
    to: '/connect-databases',
  },
  localResources: {
    icon: Boxes,
    title: 'Local Resources',
    description: 'Resources the Local Provisioner runs on your own machine, and the agent that runs them.',
    to: '/local-provisioner',
  },
  apis: {
    icon: Network,
    title: 'API Explorer',
    description: 'Browse internal APIs and their definitions before you build against them.',
    to: '/api-docs',
  },
  systems: {
    icon: Layers,
    title: 'Systems',
    description: 'How components group into systems — the architecture view of the catalog.',
    to: '/catalog?filters%5Bkind%5D=system',
  },
  dependencyGraph: {
    icon: Workflow,
    title: 'Dependency Graph',
    description: 'Explore relationships between systems, components, APIs and resources.',
    to: '/catalog-graph',
  },
  aiEpav: {
    icon: Sparkles,
    title: 'AI-Assisted Development',
    description: 'Build features with the nexus-dev EPAV loop: /evaluate \u2192 /plan \u2192 /apply \u2192 /validate, then /code-review.',
    to: `${NEXUS_DOCS}#day1`,
  },
  aiArchDocs: {
    icon: Sparkles,
    title: 'AI-Assisted Architecture',
    description: 'Architecture docs in docs/arch-docs drive nexus-dev\u2019s /scaffold and /evaluate \u2014 write them once, plan with them every task.',
    to: `${NEXUS_DOCS}#docs-folder`,
  },
  aiDatabaseReview: {
    icon: Sparkles,
    title: 'AI Database Review',
    description: 'Review schema changes, migrations and queries with nexus-dev\u2019s /database-review.',
    to: `${NEXUS_DOCS}#skills`,
  },
  aiDeploymentReview: {
    icon: Sparkles,
    title: 'AI Deployment Review',
    description: 'Check CI/CD, Docker, Kubernetes and IaC changes with nexus-dev\u2019s /deployment-review.',
    to: `${NEXUS_DOCS}#skills`,
  },
  aiOpsReview: {
    icon: Sparkles,
    title: 'AI Ops Review',
    description: 'Find observability gaps and performance risks with nexus-dev\u2019s /monitoring-review and /performance-review.',
    to: `${NEXUS_DOCS}#skills`,
  },
} satisfies Record<string, RoleTile>;

const software: RoleTile[] = [tile.appTemplates, tile.apis, tile.localResources, tile.aiEpav];

export const ROLE_TILES: Record<string, RoleTile[]> = {
  'web-team': software,
  'mobile-team': software,
  'ai-team': software,
  'qa-team': [tile.apis, tile.services, tile.localResources, tile.aiEpav],
  'data-team': [tile.databases, tile.apis, tile.localResources, tile.aiDatabaseReview],
  'cloud-team': [tile.services, tile.serviceTemplates, tile.dependencyGraph, tile.aiDeploymentReview],
  'sa-team': [tile.systems, tile.dependencyGraph, tile.apis, tile.aiArchDocs],
  'devops-team': [tile.infraTemplates, tile.serviceTemplates, tile.governanceTemplates, tile.aiDeploymentReview],
  'sre-team': [tile.services, tile.dependencyGraph, tile.systems, tile.aiOpsReview],
  'backstage-admins': [tile.governanceTemplates, tile.infraTemplates, tile.services],
};

/** Teams whose RBAC lets them see devops-team-owned templates (infrastructure, governance). */
export const DEVOPS_TEMPLATE_TEAMS: ReadonlyArray<string> = ['devops-team', 'backstage-admins'];

/** Tiles for a set of teams: merged in the given order, de-duplicated by link target. */
export const tilesForTeams = (teams: string[]): RoleTile[] => {
  const seen = new Set<string>();
  const result: RoleTile[] = [];
  for (const team of teams) {
    for (const t of ROLE_TILES[team] ?? []) {
      if (!seen.has(t.to)) {
        seen.add(t.to);
        result.push(t);
      }
    }
  }
  return result;
};
