# Retro — Bench Engineer Usage Backlog (2026-07-24)

## What was built

`docs/bench-engineer-usage-backlog.md` — a companion to `docs/bench-engineer-task-backlog.md`.
The split: **build the platform** (backstage-main: plugins, infra, tests) vs
**use the platform** (engineering-standards: templates, standards, catalog, TechDocs, training).
43 tasks across 7 series (T/S/K/X/R/P/A), IDs chosen to not collide with the build doc's F/C/D/DA/O.

## Non-obvious findings from grounding the doc

These came out of inventorying `/tank/Projects/engineering-standards` and are worth remembering
independently of the doc:

1. **Framework skeletons are the bottleneck, not templates.** 14 project templates exist but only
   **2 framework skeletons** (`nextjs`, `nestjs`). Because templates compose `frameworks/` ×
   `targets/`, one new framework skeleton multiplies across all 8 deployment targets. Any request
   for "more templates" should usually be answered with "more framework skeletons".

2. **`standards/` is 7/9 stubs.** Only `standards/common/` (git + security) is populated; web,
   mobile, data, ai-ml, cloud, qa, security are README-only. Authoring scaffolds already exist at
   `standards/_templates/{category,requirements,validation}.md.j2`. Near-zero-risk, high-value work
   that maps 1:1 onto BU expertise.

3. **CI asymmetry.** `pipelines/ci/gitlab/` has full reusable stack coverage
   (web/nextjs, web/nestjs, mobile/{flutter,ios,android}, iac/{terraform,pulumi,cloudformation},
   api/{node,python}, plus base quality + security stages). `pipelines/ci/github/` has **two
   README.md files and zero workflow files** — while the platform itself runs on GitHub Actions.

4. **The custom-action docs are stale — 3 of 16.** `docs/content/scaffolder-templates.md` documents
   `catalog:fetch-entity-info`, `infra:tofu-apply`, `github:repo:set-secret`. Actually registered in
   `packages/backend/src/plugins/scaffolder/actions/`: also `scaffolder:resolve-skeleton-url`,
   `scaffolder:get-targets`, `scaffolder:get-target-config`, `github:dispatch-workflow`,
   `github:repo:setup-promotion`, `github:repo:add-collaborator`, `kubernetes:apply`,
   `kubernetes:create-pull-secret`, `kubernetes:create-app-secrets`, `kubernetes:get-ingress-domain`,
   `stratpoint:local-provision`, `dbaas:create-project`.
   Template authors cannot use actions they don't know exist. Captured as task **A7**.

5. **`templates/training/` is already a live registered location**
   (`app-config.production.yaml:154`, rules `[Template, Location]`) with only two entries. It is the
   natural, already-wired home for bench-built learning environments — no config change needed to
   ship there.

## Constraint reinforced

There is **no template CI**. A merge to `engineering-standards@main` is a production release that
reaches every engineer on the next catalog scan. The doc therefore ships a manual
**Template PR Definition of Done** (generate → run → check catalog output → verify step order →
clean up → stack-owner review) as the stand-in until build-backlog task **D3** exists.

## Process note

`graphify path` between the two backlog docs returned **no path** — docs are graph leaves with no
inbound edges. For pure-documentation changes the graph confirms zero code blast radius but adds
nothing to the plan; the useful grounding came from directly inventorying the external
`engineering-standards` repo. Do that first next time.
