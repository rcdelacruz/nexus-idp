# Retro: Persona coverage Phase 1 (2026-10-30)

Plan: `.claude/plans/engineer-personas-value.md`. Uncommitted on `develop` + engineering-standards at
the time of writing, not deployed.

## Went well
- The expert plan review swapped plugin-grafana 1.1.0 for 0.22.0 before install, which avoided a
  nested `@backstage/ui@0.18`. The lockfile confirmed it.
- Claims were proved, not assumed:
  - `config:check` with and without the `grafana` block;
  - the dashboard selector, run through the plugin's own `QueryEvaluator`;
  - the skeleton, rendered for k8s and ecs targets;
  - proxy boot safety, run through the real `buildMiddleware`.
- The MiniStack spike ran before planning a lab around it and found that RDS data is lost on agent
  Stop/Start.

## Went wrong
- First draft of the tiles linked `cloud-team` and `data-team` to infrastructure/service/training
  template lists that RBAC hides from them. The expert diff review caught it, not tests. Now a
  pattern + test: `knowledge/patterns/ui-links-must-match-rbac-visibility.md`.
- The Grafana proxy as first written would have crash-looped the homelab backend on the next
  deploy (`GRAFANA_*` not in `backstage-secrets`). Fixed with a fallback; see
  `knowledge/patterns/proxy-target-env-var-crashes-boot.md`.
- The plan's AI-1 assumed the toolkit's docs were Markdown in `docs/`. They're HTML in `public/`.
  Held for a user decision.

## Backlog
- [ ] Admin "Training" tile in `HomePage.tsx` lacks `&trainingAccess=1`, so it opens an empty list.
- [ ] `docs/content/index.md` names lead groups `web-team-lead`; the real groups are `web-lead`, etc.
- [ ] The HomePage redirect sends a `devops-team`-only user (no dept team) to onboarding.
- [ ] `EntityGrafanaAlertsCard` renders on both Overview and the Monitoring tab when an alert
      selector is set (harmless duplication).
- [ ] HomePage resolves identity twice (its own isAdmin/isPM effect + `useDeptTeams`). Merge them.
- [ ] `'/argocd/api'` proxy target `${ARGOCD_URL}` has no fallback (same boot-crash risk as Grafana had).
- [ ] RBAC/product question: cloud-team engineers can't run any infrastructure template (all
      devops-owned). Intended?
- [ ] Post-deploy: confirm homelab Grafana tags its standard dashboards `kubernetes-mixin`; create
      the Grafana Viewer service-account token; visually check both cards in light and dark.
