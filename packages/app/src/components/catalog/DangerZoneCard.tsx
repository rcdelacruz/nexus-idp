/**
 * DangerZoneCard — entity page card, System entities only (with one
 * exception, see below).
 *
 * Teardown deletes at the repo/System level, not the Component level — a
 * System can have multiple Components sharing one repo, namespace, and
 * database (e.g. -frontend/-backend). Showing this button on every
 * individual Component page implied a narrower blast radius than what
 * actually happens, which is misleading for an irreversible action. Every
 * app created by this codebase's templates always gets a System (shared
 * catalog skeleton always creates one), so restricting to System pages is
 * safe for the real, verified case.
 *
 * Exception: a Component with no `spec.system` relation at all has no
 * System page to redirect to, so it still renders there — defensive against
 * an app that predates/bypasses that skeleton, not something confirmed to
 * exist today.
 *
 * Not reachable from /create — teardown-app is not registered in the visible
 * template catalog. This card is the only entry point, matching
 * .claude/plans/teardown-application-plan.md ("Entity Page Integration").
 * Client-side visibility here is cosmetic; the real gate is the backend RBAC
 * policy in packages/backend/src/plugins/permission.ts.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, useTheme } from '@material-ui/core';
import { InfoCard } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { useRouteRef } from '@backstage/core-plugin-api';
import { scaffolderPlugin } from '@backstage/plugin-scaffolder';
import { Trash2 } from 'lucide-react';

/**
 * Resolve the repo name this entity's teardown scope is actually keyed on —
 * same resolution order as fetchEntityInfo.ts's backend logic. This is the
 * repo/namespace-level scope (can span multiple Components sharing one repo,
 * e.g. -frontend and -backend), NOT the entity's own name — the confirmation
 * step must ask for this, not the entity name, or a correct confirmation
 * gives false confidence about what's actually being destroyed.
 */
function resolveRepoName(entity: any): string | undefined {
  const annotations = entity.metadata.annotations ?? {};
  const projectSlug = annotations['github.com/project-slug'];
  if (projectSlug) return projectSlug.split('/')[1];
  const sourceLocation = annotations['backstage.io/source-location'] ?? '';
  const match = sourceLocation.match(/github\.com\/[^/]+\/([^/]+)/);
  return match ? match[1].replace(/\.git$/, '') : undefined;
}

export const DangerZoneCard = () => {
  const { entity } = useEntity();
  const navigate = useNavigate();
  const theme = useTheme();
  const templateRoute = useRouteRef(scaffolderPlugin.routes.selectedTemplate);
  const repoName = resolveRepoName(entity);

  const isSystem = entity.kind.toLowerCase() === 'system';
  const isSystemlessComponent = entity.kind.toLowerCase() === 'component' && !(entity as any).spec?.system;
  if (!isSystem && !isSystemlessComponent) return null;

  const handleTeardown = () => {
    const entityRef = stringifyEntityRef(entity);
    // sessionStorage, not just the query string — the wizard route can
    // re-render/remount before TeardownEntityRefField reads the URL, which
    // was dropping the query param in practice. sessionStorage survives that.
    sessionStorage.setItem('teardown-entityRef', entityRef);
    if (repoName) sessionStorage.setItem('teardown-repoName', repoName);
    const path = templateRoute({ namespace: 'default', templateName: 'teardown-app' });
    navigate(`${path}?entityRef=${encodeURIComponent(entityRef)}`);
  };

  return (
    <InfoCard title="Danger Zone" variant="fullHeight">
      <p style={{ color: 'var(--fg-secondary)', fontSize: '0.875rem', marginTop: 0 }}>
        Permanently delete {repoName ? <>everything sharing the <strong>{repoName}</strong> repo</> : 'this application'} —
        namespace, database, ArgoCD app, GitHub repo, and every catalog entry
        tied to it (including other components in the same repo, e.g. a
        separate frontend/backend). This cannot be undone.
      </p>
      <Button
        variant="outlined"
        onClick={handleTeardown}
        startIcon={<Trash2 size={16} strokeWidth={1.5} />}
        style={{
          color: theme.palette.error.main,
          borderColor: theme.palette.error.main,
        }}
      >
        Teardown Application
      </Button>
    </InfoCard>
  );
};
