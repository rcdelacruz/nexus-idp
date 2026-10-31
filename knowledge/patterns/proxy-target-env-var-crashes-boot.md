# Pattern: an unset `${VAR}` proxy target crashes backend boot

**Discovered:** 2026-10-30, adding the Grafana proxy (persona coverage Phase 1).

## Constraint

The config loader does **not** fail on a missing env var. `${VAR}` with no value resolves to
`undefined` and the key is silently dropped (`@backstage/config-loader`
`sources/transform/substitution.cjs.js`). For `proxy.endpoints['/x'].target` that leaves a route
with no target, and `@backstage/plugin-proxy-backend` throws at startup:

```
Proxy target for route "/x" must be a string, but is of type undefined
```

`proxy.skipInvalidProxies` defaults to `false`, so the proxy plugin fails to start and the backend
does not boot. `config:check` stays green because the schema doesn't require `target`, so only a
real boot catches it.

A header like `Authorization: Bearer ${TOKEN}` with the var unset is dropped entirely, not sent as
`Bearer `.

## How to apply

- Every proxy `target` built from an env var gets a fallback:
  `target: ${GRAFANA_URL:-http://grafana-not-configured.invalid}`. The `.invalid` TLD is reserved
  (RFC 2606), so it is self-describing and never resolves. A missing secret then shows as a
  connection error in that plugin's UI instead of a crash-looping pod.
- Still add the secret before deploy. The fallback is a safety net, not the config.
- Prove it by resolving the config with `ConfigSources.toConfig(ConfigSources.default({ argv }))`
  (substitution reads `process.env`, not the `env` option) and calling the proxy's real
  `buildMiddleware` from `dist/service/router.cjs.js` (require it by absolute path; the subpath isn't
  exported).
- Existing exposure: base `app-config.yaml` `'/argocd/api'` uses `target: ${ARGOCD_URL}` with no
  fallback. It is fine while the secret exists, but it carries the same risk.
