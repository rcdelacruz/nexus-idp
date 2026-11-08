import express from 'express';
import request from 'supertest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { INSTALL_SCRIPT } from './installScript.generated';
import { createInstallRoute, renderInstallScript } from './installRoute';

describe('install script', () => {
  it('the embedded copy is the install.sh next to it (run gen:install after editing install.sh)', () => {
    expect(INSTALL_SCRIPT).toBe(fs.readFileSync(path.join(__dirname, 'install.sh'), 'utf8'));
  });

  it('is valid shell for sh', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-sh-'));
    const file = path.join(dir, 'install.sh');
    fs.writeFileSync(file, renderInstallScript('https://portal.example.com'));
    try {
      const r = spawnSync('sh', ['-n', file], { encoding: 'utf8' });
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe('renderInstallScript', () => {
    it('puts this portal\'s address in the script, without a trailing slash', () => {
      expect(renderInstallScript('https://portal.example.com/')).toContain("PORTAL_URL='https://portal.example.com'\n");
      expect(renderInstallScript('http://localhost:3000')).toContain("PORTAL_URL='http://localhost:3000'\n");
    });

    it('leaves the script as written for an address that is not a plain http(s) host', () => {
      for (const bad of [
        undefined,
        '',
        "https://x'; rm -rf ~; echo '",
        'https://x.example.com/a b',
        'https://x.example.com`id`',
        'https://x.example.com$(id)',
        'https://x.example.com\nrm -rf ~',
        // eslint-disable-next-line no-script-url
        'javascript:alert(1)', // test data: a scheme that must never reach the script
        'ftp://x.example.com',
        'https://x.example.com/path',
        'https://user:pw@x.example.com',
      ]) {
        const out = renderInstallScript(bad as string | undefined);
        expect(out).toBe(INSTALL_SCRIPT);
        expect(out).toContain("PORTAL_URL='__PORTAL_URL__'");
      }
    });
  });

  describe('GET /install.sh', () => {
    const app = (portalUrl?: string) => {
      const a = express();
      a.use('/agent', createInstallRoute({ portalUrl }));
      return a;
    };

    it('answers with plain text anyone can read before running it', async () => {
      const res = await request(app('https://portal.example.com')).get('/agent/install.sh');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^text\/plain; charset=utf-8/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.text).toContain("PORTAL_URL='https://portal.example.com'");
      expect(res.text.startsWith('#!/bin/sh')).toBe(true);
    });

    it('answers nothing else', async () => {
      const a = app();
      expect((await request(a).post('/agent/install.sh')).status).toBe(404);
      expect((await request(a).get('/agent/install.sh/more')).status).toBe(404);
      expect((await request(a).get('/agent/Install.sh')).status).toBe(404);
      expect((await request(a).get('/agent/other')).status).toBe(404);
    });
  });
});
