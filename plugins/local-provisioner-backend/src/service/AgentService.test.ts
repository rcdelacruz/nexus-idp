/**
 * Tests for agent service-token signing and verification.
 *
 * Before 2026-07-24 the "service token" was bare base64-encoded JSON with no signature, and
 * validation only decoded it and read `sub`. Anyone could mint a token asserting any identity
 * and reach every agent endpoint. These tests pin the properties that fix depends on —
 * particularly that a forged or tampered token is rejected.
 */

import { ConfigReader } from '@backstage/config';
import { AgentService } from './AgentService';

const SECRET = 'test-secret-do-not-use-in-production';

// `null` means "no secret configured". Not `undefined` — that would trigger JS default-
// parameter substitution and silently hand back the real secret.
function makeService(secret: string | null = SECRET) {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(),
  } as any;

  const config = new ConfigReader(
    secret === null
      ? { backend: { auth: {} } }
      : { backend: { auth: { keys: [{ secret }] } } },
  );

  return new AgentService(logger, {} as any, {} as any, config, 3600);
}

/** Reach the private signer directly — the public surface only exposes verification. */
function sign(service: AgentService, email: string): string {
  return (service as any).generateServiceToken(email);
}

describe('AgentService service tokens', () => {
  let service: AgentService;

  beforeEach(() => {
    service = makeService();
  });

  afterEach(() => {
    service.stopHeartbeat();
  });

  it('round-trips a signed token back to the user email', () => {
    const token = sign(service, 'alice@example.com');
    expect(service.verifyServiceToken(token)).toBe('alice@example.com');
  });

  it('produces a two-part token, not bare base64', () => {
    const token = sign(service, 'alice@example.com');
    expect(token.split('.')).toHaveLength(2);
  });

  // --- the vulnerability this change closes ---

  it('rejects a forged unsigned token (the pre-2026-07-24 format)', () => {
    const forged = Buffer.from(
      JSON.stringify({
        sub: 'victim@example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64');

    expect(service.verifyServiceToken(forged)).toBeNull();
  });

  it('rejects a token whose payload was tampered with', () => {
    const token = sign(service, 'alice@example.com');
    const signature = token.slice(token.lastIndexOf('.') + 1);

    const swapped = Buffer.from(
      JSON.stringify({
        sub: 'attacker@example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');

    expect(service.verifyServiceToken(`${swapped}.${signature}`)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const other = makeService('a-completely-different-secret');
    const foreign = sign(other, 'alice@example.com');
    other.stopHeartbeat();

    expect(service.verifyServiceToken(foreign)).toBeNull();
  });

  it('rejects an expired token even when correctly signed', () => {
    const realNow = Date.now;
    // Issue the token 8 days in the past so its 7-day expiry has lapsed.
    Date.now = () => realNow() - 8 * 24 * 60 * 60 * 1000;
    const stale = sign(service, 'alice@example.com');
    Date.now = realNow;

    expect(service.verifyServiceToken(stale)).toBeNull();
  });

  // --- malformed input must not throw ---

  it.each([
    ['empty string', ''],
    ['no separator', 'abcdef'],
    ['leading separator only', '.abcdef'],
    ['signature but unparseable payload', 'not-base64-json.deadbeef'],
    ['empty signature', `${Buffer.from('{}').toString('base64url')}.`],
  ])('returns null for %s rather than throwing', (_label, token) => {
    expect(() => service.verifyServiceToken(token)).not.toThrow();
    expect(service.verifyServiceToken(token)).toBeNull();
  });

  it('fails loudly when no signing secret is configured', () => {
    const unconfigured = makeService(null);
    expect(() => sign(unconfigured, 'alice@example.com')).toThrow(
      /BACKEND_SECRET/,
    );
    unconfigured.stopHeartbeat();
  });
});
