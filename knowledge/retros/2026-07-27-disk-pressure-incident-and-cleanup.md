# DiskPressure incident + housekeeping fixes (2026-07-27)

## What happened
Local Provisioner admin-activity + resource-overview UX work (GitHub repo link,
read-only resource name, Activity refresh button) was implemented and deployed
without issue. A later deploy stalled: `talos-936-p8y`, the cluster's only
schedulable worker (the other node is control-plane, NoSchedule-tainted), hit a
`DiskPressure` taint and blocked scheduling for the **entire cluster**, not just
backstage.

## Root cause
~35 `Completed` pods across nearly every namespace (devtron, longhorn-system,
monitoring, argocd, cloudflared, cnpg, etc.) had accumulated since a node event
~31 days earlier. Each retains its pod log directory and exited container's
writable layer on disk until deleted — nothing was cleaning them up. Secondary,
much smaller contributor: 17 stale `backstage@sha256:...` image digests (~6.4GB)
from repeated same-day deploys, never pruned from the node's local containerd cache.

## Fix
1. Immediate: deleted all `Succeeded`-phase pods cluster-wide (35 pods).
2. Structural: deployed `kube-janitor` (namespace `kube-janitor`, manifest lives in
   `homelab-docs` repo — cluster-wide infra, not backstage-specific, correctly does
   NOT belong in an application repo). Hourly TTL cleanup: completed/failed pods
   (24h), completed Jobs (7d), zero-replica ReplicaSets (30d backstop). Verified
   live: first run processed 293 resources, deleted 117 stale ReplicaSets + 5 stale
   Jobs, zero errors.

## Backlog (not done, deliberately deferred — flagged to the user, not silently dropped)
- **Node-local containerd image accumulation** (~6.4GB of stale backstage digests
  on talos-936-p8y). `talosctl image` has no delete/prune subcommand — Talos
  locks this down by design; only kubelet's own automatic image GC can clear it,
  and it apparently wasn't keeping up on its own. No fix applied this session.
- **Single point of failure**: the cluster has exactly one schedulable worker.
  Any resource pressure on it blocks scheduling cluster-wide, as this incident
  demonstrated. A second worker node (or tolerations allowing critical workloads
  on the control-plane node) would remove this structural risk. Not actioned —
  requires provisioning a new node, out of scope for a reactive fix session.
- **Alertmanager routing unverified**: `NodeFilesystemAlmostOutOfSpace` /
  `DiskPressure` alert rules already exist in kube-prometheus-stack, but whether
  Alertmanager actually routes them anywhere a human would see (Slack/email/etc.)
  was not checked. Worth confirming — this incident should have paged well before
  it blocked a deploy.

## Non-obvious constraints discovered (useful for next time)
- kube-janitor's `--dry-run` CLI flag is a boolean switch, not `--dry-run=false`
  key/value — passing the latter is a parse error on image `23.7.0`.
- kube-janitor rule schema key is `resources` (list), not `resource` (singular).
- The `hjacobs/kube-janitor` image has no `USER` directive (defaults to root) —
  `runAsNonRoot: true` alone fails container creation; needs explicit `runAsUser`.
- kube-janitor needs `get`/`list` on `namespaces` (not just the target resource
  types) — it enumerates namespaces first, then resources within each.
- Talos's `talosctl image` subcommand has no `rm`/`prune` — image lifecycle on a
  node is entirely kubelet-automatic, no manual lever via talosctl.
