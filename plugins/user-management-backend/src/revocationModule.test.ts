import { bearerToken, createRevocationMiddleware } from './revocationModule';

/**
 * A removed user's token must be refused whichever way the scheme is written: the framework accepts "bearer" and "BEARER", and the
 * check used to look for the exact string "Bearer " (audit 2026-11-07), so a removed admin kept working until the token expired.
 */
const jwt = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`;

describe('session revocation middleware', () => {
  const run = (authorization: string | undefined, revoked: string[], store: boolean = true) => {
    const logger = { info: jest.fn() };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    createRevocationMiddleware(() => (store ? { isRevoked: (sub: string) => revoked.includes(sub) } : null), logger)({ headers: { authorization } }, res, next);
    return { res, next, logger };
  };
  const REVOKED = 'user:default/removed.admin';

  it.each(['Bearer', 'bearer', 'BEARER', 'BeArEr'])('refuses a revoked user\'s token sent as "%s <token>"', scheme => {
    const { res, next } = run(`${scheme} ${jwt(REVOKED)}`, [REVOKED]);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses it with extra spaces after the scheme', () => {
    const { res, next } = run(`Bearer    ${jwt(REVOKED)}`, [REVOKED]);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets other users through, whichever way the scheme is written', () => {
    for (const scheme of ['Bearer', 'bearer']) {
      const { res, next } = run(`${scheme} ${jwt('user:default/someone.else')}`, [REVOKED]);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it('lets a request with no bearer token, a non-JWT token, or an unready store through (the framework\'s auth decides)', () => {
    expect(run(undefined, [REVOKED]).next).toHaveBeenCalled();
    expect(run('Basic abc', [REVOKED]).next).toHaveBeenCalled();
    expect(run('Bearer not-a-jwt', [REVOKED]).next).toHaveBeenCalled();
    expect(run(`Bearer ${jwt(REVOKED)}`, [REVOKED], false).next).toHaveBeenCalled();
  });

  it('bearerToken matches the framework\'s own parsing', () => {
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken('Bearer a b')).toBeUndefined();
  });
});
