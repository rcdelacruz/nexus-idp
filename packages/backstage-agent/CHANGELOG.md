# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial npm package preparation
- Publishing documentation
- CHANGELOG for tracking releases

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

[Unreleased]: https://github.com/stratpoint-engineering/backstage-main-strat-eng/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/stratpoint-engineering/backstage-main-strat-eng/releases/tag/v0.1.0
[0.0.1]: https://github.com/stratpoint-engineering/backstage-main-strat-eng/releases/tag/v0.0.1
