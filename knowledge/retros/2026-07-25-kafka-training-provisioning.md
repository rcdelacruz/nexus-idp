# Retro: Kafka Training local-provisioning feature (2026-07-25)

## Backlog (found, not fixed — outside this task)

- **`plugins/engineering-docs/README.md` documents the wrong annotation prefix.** It says
  `engineering-hub/source-id`, `engineering-hub/repo`, `engineering-hub/branch`,
  `engineering-hub/content-base` — but every actual working component
  (`engineering-hub-docs.yaml`, `stratpoint-idp-portal.yaml`, `kafka-training-docs.yaml`) and the
  actual frontend code (`EngineeringDocsEntityContent.tsx`) use `engineering-docs/*`. Likely a
  stale doc from before a plugin rename. Low priority, but someone reading the README and
  copying `engineering-hub/*` would hit the exact bug fixed in
  `templates/documentation/skeleton/register/catalog-info.yaml` this session.
