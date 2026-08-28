# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial npm package preparation
- Publishing documentation
- CHANGELOG for tracking releases

## [0.1.22] - 2026-07-28

### Added
- `extractConnectionDetails` now falls back to `frontendPort` for the `ui` field when
  `uiPort` is absent — previously only Kafka's `uiPort` populated it, so
  `devops-capstone-training`/`devsecops-capstone-training`'s frontend never got surfaced as a
  proper `http://` URL, only a raw `host:port` in the ports list.

## [0.1.21] - 2026-07-28

### Added
- `DockerComposeExecutor` now materializes `task.config.sourceFiles` (a base64-encoded flat
  file map) into the task directory before running `docker compose up`. Fixes
  `devops-capstone-training`/`devsecops-capstone-training` provisioning, which builds custom
  app images from source (`build: context: ./app/...`) rather than pulling public images —
  previously the agent only ever received the rendered `docker-compose.yml` text, so the
  build context was never actually present and every provision failed with
  `unable to prepare context: path ".../app/backend" not found`.

## [0.1.20] - 2026-07-26

### Changed
- **Replaced SSE + heartbeat entirely with a single HTTP long-poll loop.** 0.1.18/0.1.19
  layered fallbacks on top of SSE to work around Cloudflare's free-tier tunnel buffering/
  killing SSE connections roughly every 2 minutes — but SSE itself was still the primary path
  and still unreliable. The agent now holds a single `GET /agent/poll` request open (bounded
  to the backend's `pollTimeoutSeconds`, default 25s) and re-issues it in a loop; each response
  carries both pending tasks and the `shouldShutdown` flag. This is the only delivery
  mechanism now — no SSE connection, no separate heartbeat interval, no dual-path
  reconciliation. `SSEClient.ts` removed. The `eventsource` dependency is gone. Requires the
  local-provisioner-backend counterpart (same day) which now only serves `/agent/poll` —
  the old `/agent/events/:agentId` (SSE) and `/agent/heartbeat` endpoints are removed.
  **Breaking**: agents on 0.1.19 or earlier will lose all connectivity once the backend
  deploys this change and must run `backstage-agent update`.

## [0.1.19] - 2026-07-26

### Fixed
- 0.1.18's "Stop Agent" fix didn't actually work in practice: it relied entirely on the SSE
  `disconnect` event, but Cloudflare's tunnel buffers/kills SSE roughly every 2 minutes (the
  same known issue task delivery already works around by also delivering via the heartbeat
  response). Confirmed live: heartbeats kept flowing for minutes after the server logged the
  agent as disconnected. The agent now also checks `shouldShutdown` in every heartbeat
  response and self-SIGTERMs if set — the same reliable-delivery pattern as task pickup,
  applied to the stop signal. Requires backend counterpart (local-provisioner-backend, same
  day) to actually set the flag.
- `backstage-agent stop` and `logout` could print a scary "Failed to stop agent" /
  "Failed to logout" error with `ENOENT: ... unlink 'agent.pid'` immediately after logging
  success — a race between the command's own PID-file cleanup and the daemon's own SIGTERM
  handler doing the same cleanup (guarded with `existsSync` there, but not in these commands).
  Both now use a shared, existence-checked `safeUnlinkPidFile()`.

## [0.1.18] - 2026-07-26

### Fixed
- The UI's "Stop Agent" button never actually stopped the agent. The backend already sent a
  distinct `disconnect` SSE event before closing the connection, but `SSEClient` never
  listened for it — every connection closure, intentional or not, fell through to the same
  reconnect-with-backoff logic, so the daemon reconnected within seconds regardless. Added
  the missing listener: on `disconnect`, the client now sends itself SIGTERM, going through
  the exact same graceful-shutdown path as `backstage-agent stop` (PID cleanup, clean exit)
  instead of reconnecting.

## [0.1.17] - 2026-07-26

### Fixed
- Teardown (`down -v`) could leave the agent looking permanently hung: the timeout-kill in
  `DockerComposeExecutor.runWithProgress` only signalled the direct `docker`/`docker compose`
  child process, not the process group, so a wedged compose operation (a container not
  responding to its stop signal, a busy volume) could survive the agent's own timeout.
  Now spawns detached and kills the whole process group on timeout/error.
- `cleanupTask` (deprovision) was using the 5-minute `UP_TIMEOUT_MS` (meant for image pulls)
  instead of the 60-second `SHORT_TIMEOUT_MS` it was always grouped with in the comment —
  a wedged teardown took up to 5x longer than necessary to time out.

## [0.1.0] - 2025-12-27

### Added
- OAuth Device Code Flow (RFC 8628) for CLI authentication
- Server-Sent Events (SSE) client for real-time task reception
- Docker Compose executor for resource provisioning
- Support for Kafka provisioning
- Configuration management in `~/.backstage-agent/`
- Comprehensive Winston logging
- Graceful shutdown handlers
- Automatic reconnection with exponential backoff
- Status reporting to Backstage backend

### Technical Details
- CLI built with Commander.js
- TypeScript with strict mode
- Node.js 18+ required
- Docker and Docker Compose required

### Phase 3 Implementation
- Complete end-to-end local provisioning system
- Integration with Backstage Local Provisioner plugin
- Template rendering with Mustache
- Task status lifecycle: pending → in-progress → completed/failed

## [0.0.1] - 2025-12-26

### Added
- Initial monorepo package structure
- Core agent architecture
- Authentication layer
- SSE client implementation
- Docker Compose executor
- Configuration management
- CLI commands (login, start)

---

## Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md` under `## [Unreleased]`
3. Create new version section in `CHANGELOG.md`
4. Commit: `git commit -am "chore: release vX.Y.Z"`
5. Tag: `git tag vX.Y.Z`
6. Push: `git push && git push --tags`
7. Build: `yarn clean && yarn build`
8. Publish: `npm publish --access public`

[Unreleased]: https://github.com/stratpoint-engineering/backstage-main/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/stratpoint-engineering/backstage-main/releases/tag/v0.1.0
[0.0.1]: https://github.com/stratpoint-engineering/backstage-main/releases/tag/v0.0.1
