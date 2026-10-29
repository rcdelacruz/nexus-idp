# Pattern: `backstage-cli package test` "hangs" = Jest watch mode

**Discovered:** 2026-10-29, during the 1.54.6 → 1.56.2 bump (also explains the unresolved hang in the 1.54.6 bump).

## Constraint

`backstage-cli package test` starts Jest in **watch mode** whenever the `CI` environment
variable is unset. `--ci`, `--all` and `--forceExit` do NOT disable it. The symptom looks like a
hang: the log shows only `No tests found related to files changed since last commit.`, then the
process idles at ~0% CPU forever (it is waiting for file changes). Wrapping it in `yarn workspace`
or backgrounding it changes nothing.

## Fix

```bash
cd <pkg-dir> && CI=true yarn backstage-cli package test --forceExit
```

Returns in 2–4s (local-provisioner-backend 63 tests in 2.1s).

## Takeaway

If a test command produces that one line and nothing else, it's watch mode — set `CI=true`;
don't chase locks, zombies or DB connections.
