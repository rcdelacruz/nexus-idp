import express from 'express';
import request from 'supertest';
import { jsonBody, limitFor } from './bodyLimits';

describe('limitFor', () => {
  it('gives a lot only to a task (source tree) and an agent status report; 100 kb to everything else', () => {
    expect(limitFor('POST', '/tasks')).toBe('10mb');
    expect(limitFor('POST', '/tasks/')).toBe('10mb');
    expect(limitFor('PUT', '/agent/tasks/abc-123/status')).toBe('1mb');
    expect(limitFor('POST', '/capstones/enrollments/abc-123/complete')).toBe('1mb');
    expect(limitFor('GET', '/capstones/enrollments/abc-123/complete')).toBe('100kb');
    expect(limitFor('POST', '/capstones/enrollments/abc-123/reopen')).toBe('100kb');
    for (const [m, p] of [
      ['POST', '/agent/device/code'],
      ['POST', '/agent/device/token'],
      ['POST', '/agent/register'],
      ['GET', '/agent/poll'],
      ['POST', '/tasks/abc/dispatch'],
      ['POST', '/tasks/admin/trainees/remove'],
      ['PUT', '/tasks'], // wrong method for the big route
      ['POST', '/agent/tasks/abc/status'], // wrong method for the status route
      ['PUT', '/agent/tasks/abc/status/extra'],
      ['PUT', '/agent/tasks//status'],
      ['POST', '/capstones/enrollments'],
    ]) {
      expect(limitFor(m, p)).toBe('100kb');
    }
  });
});

describe('jsonBody on a real express app', () => {
  const app = () => {
    const a = express();
    a.use(jsonBody);
    a.all('*', (_req, res) => res.status(200).json({ ok: true }));
    // the router's error handler maps these two body-parser errors the same way
    const statusOf: Record<string, number> = { 'entity.too.large': 413, 'entity.parse.failed': 400 };
    a.use((err: any, _req: any, res: any, _next: any) => res.status(statusOf[err.type] ?? 500).json({}));
    return a;
  };
  const body = (bytes: number) => JSON.stringify({ pad: 'x'.repeat(bytes) });

  it('takes a 2 MB task and refuses 11 MB', async () => {
    expect((await request(app()).post('/tasks').set('content-type', 'application/json').send(body(2 * 1024 * 1024))).status).toBe(200);
    expect((await request(app()).post('/tasks').set('content-type', 'application/json').send(body(11 * 1024 * 1024))).status).toBe(413);
  });

  it('takes a 500 kb status report and refuses 2 MB', async () => {
    expect((await request(app()).put('/agent/tasks/abc/status').set('content-type', 'application/json').send(body(500 * 1024))).status).toBe(200);
    expect((await request(app()).put('/agent/tasks/abc/status').set('content-type', 'application/json').send(body(2 * 1024 * 1024))).status).toBe(413);
  });

  it('takes a 600 kb lab report when a capstone is marked done, and refuses 2 MB', async () => {
    expect((await request(app()).post('/capstones/enrollments/abc/complete').set('content-type', 'application/json').send(body(600 * 1024))).status).toBe(200);
    expect((await request(app()).post('/capstones/enrollments/abc/complete').set('content-type', 'application/json').send(body(2 * 1024 * 1024))).status).toBe(413);
  });

  it('refuses 200 kb on every other route, the unauthenticated ones included', async () => {
    for (const [m, p] of [['post', '/agent/device/code'], ['post', '/agent/device/token'], ['post', '/agent/register'], ['post', '/tasks/x/dispatch']] as const) {
      const res = await (request(app()) as any)[m](p).set('content-type', 'application/json').send(body(200 * 1024));
      expect(res.status).toBe(413);
    }
    expect((await request(app()).post('/agent/device/code').set('content-type', 'application/json').send(body(50 * 1024))).status).toBe(200);
  });

  it('a body that is not JSON is a 400, not a server error', async () => {
    expect((await request(app()).post('/agent/device/code').set('content-type', 'application/json').send('{"a":')).status).toBe(400);
  });
});

describe('what "trust proxy: 1" means for the address a rate limiter sees', () => {
  const ipSeenBy = async (trust: boolean | number, xff: string) => {
    const a = express();
    a.set('trust proxy', trust);
    a.get('/ip', (req, res) => res.json({ ip: req.ip }));
    return (await request(a).get('/ip').set('x-forwarded-for', xff)).body.ip as string;
  };

  it('one hop: the address the proxy appended, whatever the visitor wrote before it', async () => {
    // visitor sends "X-Forwarded-For: 1.1.1.1"; the tunnel appends the address it actually saw (9.9.9.9)
    expect(await ipSeenBy(1, '1.1.1.1, 9.9.9.9')).toBe('9.9.9.9');
    expect(await ipSeenBy(1, '2.2.2.2, 9.9.9.9')).toBe('9.9.9.9');
  });

  it('true takes the first entry, which the visitor writes: one address can dodge a limit just by changing the header', async () => {
    expect(await ipSeenBy(true, '1.1.1.1, 9.9.9.9')).toBe('1.1.1.1');
    expect(await ipSeenBy(true, '2.2.2.2, 9.9.9.9')).toBe('2.2.2.2');
  });
});
