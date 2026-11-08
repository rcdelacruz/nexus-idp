import express, { RequestHandler } from 'express';

/**
 * How much JSON a request may carry. The router used to take 10 MB on EVERY route, including the unauthenticated ones (agent login
 * codes, tokens, register, poll), so anyone on the internet could make the portal buffer and parse 10 MB per request. Only two
 * routes carry a lot:
 *   POST /tasks                     a task with a base64 source tree (stratpoint:local-provision sourceFiles)   10 MB
 *   PUT  /agent/tasks/:id/status    an agent's report with logs and connection details                          1 MB
 *   POST /capstones/enrollments/:id/complete  the lab report kept when an instructor marks a capstone done          1 MB
 * Everything else takes the 100 kb default.
 */
export type BodyLimit = '10mb' | '1mb' | '100kb';

export function limitFor(method: string, path: string): BodyLimit {
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  if (method === 'POST' && p === '/tasks') return '10mb';
  if (method === 'PUT' && /^\/agent\/tasks\/[^/]+\/status$/.test(p)) return '1mb';
  // An instructor marking a capstone done sends the lab report with it (the store keeps at most 512 KB).
  if (method === 'POST' && /^\/capstones\/enrollments\/[^/]+\/complete$/.test(p)) return '1mb';
  return '100kb';
}

const parsers: Record<BodyLimit, RequestHandler> = {
  '10mb': express.json({ limit: '10mb' }),
  '1mb': express.json({ limit: '1mb' }),
  '100kb': express.json({ limit: '100kb' }),
};

/** express.json with the limit that belongs to this route. */
export const jsonBody: RequestHandler = (req, res, next) => parsers[limitFor(req.method, req.path)](req, res, next);
