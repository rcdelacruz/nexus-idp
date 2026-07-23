# Pattern: Backstage 1.53 bump requires explicit jsdom test deps (Jest 30)

**Discovered:** 2026-07-23, during 1.52.1 → 1.53.0 upgrade (E→P→A→V validate step).

## Constraint

Backstage 1.53.0 upgrades the test toolchain to **Jest 30**. Jest 30 no longer bundles
the jsdom test environment. Any frontend/React package using the `jsdom` test environment
fails at config load with:

```
Error: Jest 30+ requires @jest/environment-jsdom-abstract and jsdom.
Please install them as dev dependencies.
```

This does NOT show up in `tsc` (compiles clean) — it only surfaces when running the test
suite. Easy to miss if you gate a version bump on compile only.

## Fix

Add both to the **root** `package.json` devDependencies:

```bash
yarn add -D '@jest/environment-jsdom-abstract@^30.0.0' 'jsdom@^26.0.0'
```

`@jest/environment-jsdom-abstract` peers `jsdom: '*'`, so the jsdom major is flexible; ^26
is a safe, current choice for Jest 30.

## Takeaway for future bumps

When a Backstage bump crosses a Jest major (check `yarn why jest`), run the **test** gate,
not just `tsc` — the test-infra breakage is invisible to the compiler. See the E→P→A→V
`/validate` step: compile-clean ≠ test-runnable.
