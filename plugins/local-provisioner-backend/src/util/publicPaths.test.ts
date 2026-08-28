/**
 * Tests for the public/protected path classification shared by the framework barrier
 * (plugin.ts) and the router middleware (service/router.ts).
 *
 * This is a security boundary: a path wrongly classified public exposes an unauthenticated
 * route; one wrongly classified protected locks out an agent. The cases below pin every real
 * route in the plugin.
 */

import { isPublicAgentPath, PUBLIC_AGENT_PATHS } from './publicPaths';

describe('isPublicAgentPath', () => {
  describe('public agent endpoints', () => {
    it.each([
      '/health',
      '/health/ready',
      '/health/live',
      '/agent/device/code',
      '/agent/device/token',
      '/agent/register',
      '/agent/poll',
      '/agent/tasks/abc-123/status',
      '/agent/tasks/00000000-0000-0000-0000-000000000000/status',
    ])('treats %s as public', path => {
      expect(isPublicAgentPath(path)).toBe(true);
    });
  });

  describe('protected endpoints (require a Backstage credential)', () => {
    it.each([
      ['plugin root', '/'],
      ['task list', '/tasks'],
      ['single task', '/tasks/abc-123'],
      ['task stats', '/tasks/stats/summary'],
      ['agent list', '/agent'],
      ['single agent', '/agent/agent-123'],
      ['device authorize — identity is established here', '/agent/device/authorize'],
      ['agent disconnect', '/agent/agent-123/disconnect'],
      ['agent revoke', '/agent/agent-123/revoke'],
    ])('treats %s (%s) as protected', (_label, path) => {
      expect(isPublicAgentPath(path)).toBe(false);
    });
  });

  describe('does not over-match on prefixes', () => {
    it.each([
      // The classic startsWith('/health') bug this replaces:
      '/healthfoo',
      '/health-secret',
      '/healthz-internal',
      // Not the status sub-path:
      '/agent/tasks/abc-123',
      '/agent/tasks',
      // Wrong leading segment:
      '/agentfoo/device/code',
    ])('does not treat %s as public', path => {
      expect(isPublicAgentPath(path)).toBe(false);
    });
  });

  it('classifies every declared PUBLIC_AGENT_PATH as public when its params are filled', () => {
    for (const pattern of PUBLIC_AGENT_PATHS) {
      const concrete = pattern.replace(/:[^/]+/g, 'x');
      expect(isPublicAgentPath(concrete)).toBe(true);
    }
  });
});
