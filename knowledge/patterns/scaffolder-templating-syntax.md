
## fetch:template skeleton files use `${{ values.x }}` by default (2026-07-25, corrected)

**Correction:** an earlier version of this note claimed plain `{{ values.x }}` (no `$`) was
correct for `fetch:template` skeleton-file content, based on copying the pre-existing
`docker-compose.yml` skeleton's syntax without verifying it actually rendered. That
skeleton was itself unverified — it had never been confirmed end-to-end — and was wrong.

**Ground truth**, confirmed by reading the installed rendering engine source directly
(`node_modules/@backstage/plugin-scaffolder-backend/dist/lib/templating/SecureTemplater.cjs.js`):
`fetch:template`'s default `render()` (used unless a step sets `cookiecutterCompat: true`)
configures Nunjucks with `tags: { variableStart: '${{', variableEnd: '}}' }`. Plain
`{{ values.x }}` only works if the step explicitly opts into `cookiecutterCompat: true`,
which enables a *separate* `renderCompat()` path with the plain-`{{ }}` config instead.

So: **`${{ values.x }}` is correct in skeleton-file content by default** — the same
delimiter as `template.yaml`'s own step-input syntax (`${{ parameters.x }}`), not a
different one. Block tags (`{% if %}` / `{% endif %}`) are unaffected either way — only
the `variableStart`/`variableEnd` for `{{ }}` expressions changes.

**Don't trust an existing skeleton file as ground truth without confirming it actually
rendered.** The original bug survived undetected in `docker-compose.yml` because no one
had inspected the actual substituted output sent to the agent — a "successful" scaffolder
run just means the step didn't throw, not that interpolation happened. Confirm by reading
the actual rendering engine's config (or the real rendered output) before trusting an
existing pattern, especially one that was never independently verified end-to-end.
