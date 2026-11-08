/**
 * The rate limiters on the unauthenticated agent-login routes key on req.ip. Express only reads the forwarded address when
 * `trust proxy` is set, and Backstage's root router sets it from `backend.trustProxy`. The production config had the setting under
 * `backend.proxy.trustProxy`, which nothing reads: the live log said "X-Forwarded-For header is set but the Express 'trust proxy'
 * setting is false", so every visitor shared one bucket (audit 2026-11-07). And `true` is no better: it trusts the first
 * X-Forwarded-For entry, which the visitor writes, so the limit could be dodged by sending the header.
 */
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

const read = (file: string) => yaml.parse(fs.readFileSync(path.resolve(__dirname, '../../../../', file), 'utf8'));

describe('trusting the proxy in front of the portal', () => {
  const production = read('app-config.production.yaml');

  it('production trusts exactly one hop, under the key Backstage reads', () => {
    expect(production.backend.trustProxy).toBe(1);
  });

  it('never trusts every hop (`true`), which lets a visitor choose their own address', () => {
    for (const file of ['app-config.yaml', 'app-config.production.yaml', 'app-config.on-prem.yaml']) {
      const value = read(file).backend?.trustProxy;
      expect(value === undefined || (typeof value === 'number' && value >= 1 && value <= 2)).toBe(true);
    }
  });

  it('the old, ignored key is gone', () => {
    expect(production.backend.proxy).toBeUndefined();
  });
});
