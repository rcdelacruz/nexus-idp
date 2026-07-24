import { ConfigReader } from '@backstage/config';
import {
  resolveEmailDomainFromConfig,
  setEmailDomain,
  emailDomain,
  extractEmailFromEntityRef,
} from './identity';

describe('identity domain resolution', () => {
  afterEach(() => setEmailDomain(undefined));

  it('resolves the domain from google auth allowedDomains (production key)', () => {
    const config = new ConfigReader({
      auth: { providers: { google: { production: { allowedDomains: ['example.com'] } } } },
    });
    expect(resolveEmailDomainFromConfig(config)).toBe('example.com');
  });

  it('builds a stable email identity from the configured allowedDomains', () => {
    const config = new ConfigReader({
      auth: { providers: { google: { production: { allowedDomains: ['example.com'] } } } },
    });
    setEmailDomain(resolveEmailDomainFromConfig(config));
    // Bare username -> username@<allowedDomains[0]> — the domain must come from config,
    // not a hardcoded value, so existing identities are preserved after this change.
    expect(extractEmailFromEntityRef('user:default/jane.doe')).toBe('jane.doe@example.com');
  });

  it('works across any env key (development)', () => {
    const config = new ConfigReader({
      auth: { providers: { google: { development: { allowedDomains: ['acme.io'] } } } },
    });
    expect(resolveEmailDomainFromConfig(config)).toBe('acme.io');
  });

  it('honours the AGENT_EMAIL_DOMAIN override above config', () => {
    const config = new ConfigReader({
      auth: { providers: { google: { production: { allowedDomains: ['example.com'] } } } },
    });
    const prev = process.env.AGENT_EMAIL_DOMAIN;
    process.env.AGENT_EMAIL_DOMAIN = 'override.dev';
    try {
      expect(resolveEmailDomainFromConfig(config)).toBe('override.dev');
    } finally {
      if (prev === undefined) delete process.env.AGENT_EMAIL_DOMAIN;
      else process.env.AGENT_EMAIL_DOMAIN = prev;
    }
  });

  it('returns undefined when nothing configured, and emailDomain falls back to localhost', () => {
    const config = new ConfigReader({});
    expect(resolveEmailDomainFromConfig(config)).toBeUndefined();
    setEmailDomain(resolveEmailDomainFromConfig(config));
    expect(emailDomain()).toBe('localhost');
  });

  it('passes through an entity ref that is already an email', () => {
    expect(extractEmailFromEntityRef('user:default/someone@example.com')).toBe(
      'someone@example.com',
    );
  });
});
