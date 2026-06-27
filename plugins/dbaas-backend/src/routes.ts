import Router from 'express-promise-router';
import express, { Request, Response } from 'express';
import { NotFoundError, InputError, ConflictError } from '@backstage/errors';
import { HttpAuthService, UserInfoService, LoggerService, RootConfigService } from '@backstage/backend-plugin-api';
import { DbaasStore } from './database/DbaasStore';
import { encrypt, decrypt } from './crypto';
import { getAllProviderInfo, getProvider } from './providers/registry';
import { triggerProviderRefresh } from './sharedProvider';

const SYNC_RATE_LIMIT_SECONDS = 60;

export function createRouter(options: {
  logger: LoggerService;
  httpAuth: HttpAuthService;
  userInfo: UserInfoService;
  config: RootConfigService;
  store: DbaasStore;
}) {
  const { logger, httpAuth, userInfo, config, store } = options;
  const backendSecret = config.getConfigArray('backend.auth.keys')[0].getString('secret');

  const router = Router();
  router.use(express.json());

  // ── GET /providers ─────────────────────────────────────────────────────────
  // Returns the list of supported providers for the marketplace grid.
  // Declared unauthenticated — httpRouter.addAuthPolicy handles this in plugin.ts
  router.get('/providers', (_req: Request, res: Response) => {
    res.json({ providers: getAllProviderInfo() });
  });

  // ── GET /connections ────────────────────────────────────────────────────────
  router.get('/connections', async (req: Request, res: Response) => {
    const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
    const { userEntityRef } = await userInfo.getUserInfo(credentials);

    const connections = await store.getConnectionsByUser(userEntityRef);
    res.json({
      connections: connections.map(c => ({
        id: c.id,
        provider: c.provider,
        label: c.label,
        visibility: c.visibility,
        ownerRef: c.owner_ref,
        lastSynced: c.last_synced?.toISOString() ?? null,
        lastError: c.last_error ?? null,
        createdAt: c.created_at.toISOString(),
      })),
    });
  });

  // ── POST /connections ───────────────────────────────────────────────────────
  router.post('/connections', async (req: Request, res: Response) => {
    const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
    const { userEntityRef } = await userInfo.getUserInfo(credentials);
    logger.info(`DBaaS: POST /connections from ${userEntityRef}, provider=${req.body?.provider}`);

    const { provider, label, credentials: rawCreds, visibility, teamRef } = req.body;

    if (!provider || !label || !rawCreds) {
      throw new InputError('provider, label, and credentials are required');
    }
    // M4: label length guard
    if (typeof label !== 'string' || label.trim().length === 0 || label.length > 100) {
      throw new InputError('label must be between 1 and 100 characters');
    }
    if (!getAllProviderInfo().some(p => p.id === provider)) {
      throw new InputError(`Unknown provider: ${provider}`);
    }
    if (visibility !== 'personal' && visibility !== 'team') {
      throw new InputError('visibility must be personal or team');
    }
    // H1: teamRef must be present and a valid group entity ref pattern
    if (visibility === 'team') {
      if (!teamRef || typeof teamRef !== 'string' || !/^group:[^/]+\/.+$/.test(teamRef.trim())) {
        throw new InputError('teamRef must be a valid group entity ref (e.g. group:default/my-team) when visibility is team');
      }
    }

    const providerImpl = getProvider(provider);
    if (!providerImpl) throw new InputError(`Unknown provider: ${provider}`);

    // H4: Validate credentials but sanitize error message — don't leak raw provider API responses
    try {
      await providerImpl.fetchDatabases(rawCreds);
    } catch (err: any) {
      logger.warn(`DBaaS: credential validation failed for provider ${provider}: ${err.message}`);
      throw new InputError('Credential validation failed. Please verify the API key is correct and has the required permissions.');
    }

    const ownerRef = visibility === 'team' ? teamRef.trim() : userEntityRef;
    const encryptedCreds = encrypt(JSON.stringify(rawCreds), backendSecret);

    let connection;
    try {
      connection = await store.addConnection({
        userRef: userEntityRef,
        provider,
        label,
        credentials: encryptedCreds,
        visibility,
        ownerRef,
      });
    } catch (err: any) {
      if (err.message?.includes('unique') || err.message?.includes('duplicate')) {
        throw new ConflictError(`A connection named "${label}" for ${provider} already exists`);
      }
      throw err;
    }

    logger.info(`DBaaS: user ${userEntityRef} added ${provider} connection "${label}" (${connection.id})`);

    // Trigger async catalog refresh — don't await (user gets response immediately)
    triggerProviderRefresh();

    res.status(201).json({
      connection: {
        id: connection.id,
        provider: connection.provider,
        label: connection.label,
        visibility: connection.visibility,
        ownerRef: connection.owner_ref,
        lastSynced: null,
        lastError: null,
        createdAt: connection.created_at.toISOString(),
      },
    });
  });

  // ── DELETE /connections/:id ─────────────────────────────────────────────────
  router.delete('/connections/:id', async (req: Request, res: Response) => {
    const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
    const { userEntityRef } = await userInfo.getUserInfo(credentials);

    const connection = await store.getConnectionById(req.params.id);
    if (!connection) throw new NotFoundError(`Connection ${req.params.id} not found`);
    if (connection.user_ref !== userEntityRef) throw new NotFoundError(`Connection ${req.params.id} not found`);

    await store.deleteConnection(connection.id);

    logger.info(`DBaaS: user ${userEntityRef} removed ${connection.provider} connection "${connection.label}" (${connection.id})`);

    // Full refresh removes the deleted connection's entities (orphan detection)
    triggerProviderRefresh();

    res.status(204).end();
  });

  // ── POST /connections/:id/sync ──────────────────────────────────────────────
  router.post('/connections/:id/sync', async (req: Request, res: Response) => {
    const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
    const { userEntityRef } = await userInfo.getUserInfo(credentials);

    const connection = await store.getConnectionById(req.params.id);
    if (!connection) throw new NotFoundError(`Connection ${req.params.id} not found`);
    if (connection.user_ref !== userEntityRef) throw new NotFoundError(`Connection ${req.params.id} not found`);

    // Rate limit: 1 sync per connection per minute (DB-based, survives pod restarts)
    if (connection.last_synced) {
      const secondsSinceLast = (Date.now() - connection.last_synced.getTime()) / 1000;
      if (secondsSinceLast < SYNC_RATE_LIMIT_SECONDS) {
        res.status(429).json({
          error: `Rate limited — please wait ${Math.ceil(SYNC_RATE_LIMIT_SECONDS - secondsSinceLast)}s before syncing again`,
        });
        return;
      }
    }

    // H2: Update last_synced BEFORE triggering the async refresh to close the
    // rate-limit race window. Without this, a concurrent request can read the
    // stale timestamp and also pass the check before the refresh updates it.
    await store.updateSyncStatus(req.params.id, { lastSynced: new Date() });

    // Trigger full refresh (all connections) — includes this one
    triggerProviderRefresh();

    res.json({ message: 'Sync triggered' });
  });

  // ── POST /scaffold/create-project ──────────────────────────────────────────
  // Called by the scaffolder action (service-to-service). Looks up the user's
  // stored credentials for the given provider and creates a new cloud project.
  router.post('/scaffold/create-project', async (req: Request, res: Response) => {
    await httpAuth.credentials(req as any, { allow: ['service'] });

    const { userRef, provider, projectName } = req.body;
    if (!userRef || !provider || !projectName) {
      throw new InputError('userRef, provider, and projectName are required');
    }

    const connections = await store.getConnectionsByUser(userRef);
    const conn = connections.find(c => c.provider === provider);
    if (!conn) {
      throw new NotFoundError(
        `No ${provider} connection found for ${userRef}. Add one in the DBaaS catalog first.`,
      );
    }

    const providerImpl = getProvider(provider);
    if (!providerImpl) throw new NotFoundError(`Provider ${provider} not available`);
    if (!providerImpl.createProject) {
      throw new InputError(`Provider ${provider} does not support on-demand project creation`);
    }

    const rawCreds = JSON.parse(decrypt(conn.credentials, backendSecret));

    try {
      const project = await providerImpl.createProject(rawCreds, projectName);
      logger.info(`DBaaS: scaffold created ${provider} project "${project.name}" (${project.id}) for ${userRef}`);
      res.json({ project });
    } catch (err: any) {
      logger.error(`DBaaS: failed to create ${provider} project "${projectName}" for ${userRef}: ${err.message}`);
      throw new Error(`Failed to create ${provider} project: ${err.message}`);
    }
  });

  // ── GET /connections/:id/databases ──────────────────────────────────────────
  router.get('/connections/:id/databases', async (req: Request, res: Response) => {
    const credentials = await httpAuth.credentials(req as any, { allow: ['user'] });
    const { userEntityRef } = await userInfo.getUserInfo(credentials);

    const connection = await store.getConnectionById(req.params.id);
    if (!connection) throw new NotFoundError(`Connection ${req.params.id} not found`);
    if (connection.user_ref !== userEntityRef) throw new NotFoundError(`Connection ${req.params.id} not found`);

    const provider = getProvider(connection.provider);
    if (!provider) throw new NotFoundError(`Provider ${connection.provider} not available`);

    try {
      const rawCreds = JSON.parse(decrypt(connection.credentials, backendSecret));
      const databases = await provider.fetchDatabases(rawCreds);
      res.json({ databases });
    } catch (err: any) {
      logger.warn(`DBaaS: failed to fetch databases for connection ${connection.id}: ${err.message}`);
      res.status(502).json({ error: `Failed to fetch from provider: ${err.message}` });
    }
  });

  return router;
}
