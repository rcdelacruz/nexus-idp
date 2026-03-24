import { Router } from 'express';
import { LoggerService } from '@backstage/backend-plugin-api';
import { ResourceService } from '../service/ResourceService';

const VALID_TYPES = ['ec2', 'ebs', 'rds', 'elb', 'eip', 's3', 'vpc-endpoint'];

const ALL_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
  'eu-west-1', 'eu-west-2', 'eu-central-1',
  'sa-east-1', 'ca-central-1',
];

const REGION_CONCURRENCY = 3;
const REGION_TIMEOUT_MS = 30_000;

type Resolver = (accountId: string) => { resourceService: ResourceService } | undefined;

import { UnusedResourceEntry } from '../service/ResourceService';

type RegionResult = { ec2: UnusedResourceEntry[]; ebs: UnusedResourceEntry[]; rds: UnusedResourceEntry[]; elb: UnusedResourceEntry[]; eip: UnusedResourceEntry[]; s3: UnusedResourceEntry[]; vpcEndpoints: UnusedResourceEntry[] };

const emptyRegionResult = (): RegionResult => ({ ec2: [], ebs: [], rds: [], elb: [], eip: [], s3: [], vpcEndpoints: [] });

async function scanRegion(
  resourceService: ResourceService,
  region: string,
  thresholdDays: number | undefined,
  logger: LoggerService,
): Promise<RegionResult> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`timeout`)), REGION_TIMEOUT_MS),
  );
  const scan = Promise.all([
    resourceService.getUnusedEC2(region, thresholdDays).catch(e => { logger.warn(`EC2 scan failed (${region}): ${e.message}`); return []; }),
    resourceService.getUnusedEBS(region, thresholdDays).catch(e => { logger.warn(`EBS scan failed (${region}): ${e.message}`); return []; }),
    resourceService.getUnusedRDS(region, thresholdDays).catch(e => { logger.warn(`RDS scan failed (${region}): ${e.message}`); return []; }),
    resourceService.getUnusedELB(region, thresholdDays).catch(e => { logger.warn(`ELB scan failed (${region}): ${e.message}`); return []; }),
    resourceService.getUnusedEIPs(region).catch(e => { logger.warn(`EIP scan failed (${region}): ${e.message}`); return []; }),
    resourceService.getUnusedS3(region, thresholdDays).catch(e => { logger.warn(`S3 scan failed (${region}): ${e.message}`); return []; }),
    resourceService.getUnusedVpcEndpoints(region, thresholdDays).catch(e => { logger.warn(`VPC Endpoint scan failed (${region}): ${e.message}`); return []; }),
  ]).then(([ec2, ebs, rds, elb, eip, s3, vpcEndpoints]) => ({ ec2, ebs, rds, elb, eip, s3, vpcEndpoints }));

  return Promise.race([scan, timeout]);
}

async function scanInBatches(
  resourceService: ResourceService,
  regions: string[],
  thresholdDays: number | undefined,
  logger: LoggerService,
): Promise<{ results: Map<string, RegionResult>; timedOut: string[] }> {
  const results = new Map<string, RegionResult>();
  const timedOut: string[] = [];

  for (let i = 0; i < regions.length; i += REGION_CONCURRENCY) {
    const batch = regions.slice(i, i + REGION_CONCURRENCY);
    await Promise.all(
      batch.map(async region => {
        try {
          results.set(region, await scanRegion(resourceService, region, thresholdDays, logger));
        } catch (err: any) {
          logger.warn(`Region ${region} skipped: ${err.message}`);
          timedOut.push(region);
          results.set(region, emptyRegionResult());
        }
      }),
    );
  }

  return { results, timedOut };
}

export function createResourceRoutes(resolver: Resolver, logger: LoggerService): Router {
  const router = Router();

  router.get('/regions', async (req, res) => {
    const accountId = String(req.query.account ?? '');
    const services = resolver(accountId);
    if (!services) { res.status(400).json({ error: `Unknown account: ${accountId}` }); return; }
    try {
      const regions = await services.resourceService.getActiveRegions(ALL_REGIONS);
      res.json({ regions });
    } catch (err: any) {
      logger.error('Failed to get active regions', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/unused', async (req, res) => {
    const accountId = String(req.query.account ?? '');
    const services = resolver(accountId);
    if (!services) { res.status(400).json({ error: `Unknown account: ${accountId}` }); return; }
    const resourceService = services.resourceService;
    try {
      const regionParam = String(req.query.region ?? 'all');
      const thresholdDays = req.query.thresholdDays ? parseInt(String(req.query.thresholdDays), 10) : undefined;
      const regions = regionParam === 'all' ? ALL_REGIONS : [regionParam];

      const cacheKey = `unused:${regionParam}:${thresholdDays ?? 'all'}`;
      const payload = await resourceService.cachedScan(cacheKey, async () => {
        logger.info(`Scanning ${regions.length} region(s) in batches of ${REGION_CONCURRENCY}, threshold: ${thresholdDays ?? 'default'} days`);
        const { results, timedOut } = await scanInBatches(resourceService, regions, thresholdDays, logger);

        const merged = Array.from(results.values()).reduce(
          (acc, r) => ({
            ec2: [...acc.ec2, ...r.ec2],
            ebs: [...acc.ebs, ...r.ebs],
            rds: [...acc.rds, ...r.rds],
            elb: [...acc.elb, ...r.elb],
            eip: [...acc.eip, ...r.eip],
            s3: [...acc.s3, ...r.s3],
            vpcEndpoints: [...acc.vpcEndpoints, ...r.vpcEndpoints],
          }),
          emptyRegionResult(),
        );

        if (timedOut.length > 0) {
          logger.warn(`Regions timed out (>${REGION_TIMEOUT_MS / 1000}s): ${timedOut.join(', ')}`);
        }

        return { ...merged, 'vpc-endpoint': merged.vpcEndpoints, regions, timed_out_regions: timedOut };
      });

      res.json(payload);
    } catch (err: any) {
      logger.error('Failed to get unused resources', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:type/:id/dependencies', async (req, res) => {
    const accountId = String(req.query.account ?? '');
    const services = resolver(accountId);
    if (!services) { res.status(400).json({ error: `Unknown account: ${accountId}` }); return; }
    const resourceService = services.resourceService;
    const { type, id } = req.params;
    const region = String(req.query.region ?? 'us-east-1');

    if (!VALID_TYPES.includes(type)) {
      res.status(400).json({ error: `Invalid resource type: ${type}` });
      return;
    }

    try {
      const result = await resourceService.checkDependencies(type, id, region);
      res.json(result);
    } catch (err: any) {
      logger.error(`Dependency check failed for ${type} ${id}`, { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/bulk-delete', async (req, res) => {
    const accountId = String(req.query.account ?? req.body.account ?? '');
    const services = resolver(accountId);
    if (!services) { res.status(400).json({ error: `Unknown account: ${accountId}` }); return; }
    const resourceService = services.resourceService;
    const user = (req as any).user?.userEntityRef ?? 'unknown';
    const resources: { type: string; id: string; region: string }[] = req.body.resources ?? [];

    if (!Array.isArray(resources) || resources.length === 0) {
      res.status(400).json({ error: 'resources array is required' });
      return;
    }

    const invalid = resources.find(r => !VALID_TYPES.includes(r.type));
    if (invalid) { res.status(400).json({ error: `Invalid resource type: ${invalid.type}` }); return; }

    logger.info(`Bulk deleting ${resources.length} resources`, { deletedBy: user });

    const results = await Promise.all(
      resources.map(async r => {
        try {
          let result: any;
          switch (r.type) {
            case 'ec2': result = await resourceService.deleteEC2(r.id, r.region); break;
            case 'ebs': result = await resourceService.deleteEBS(r.id, r.region); break;
            case 'rds': result = await resourceService.deleteRDS(r.id, r.region); break;
            case 'elb': result = await resourceService.deleteELB(r.id, r.region); break;
            case 'eip': result = await resourceService.releaseEIP(r.id, r.region); break;
            case 's3': result = await resourceService.deleteS3Bucket(r.id, r.region); break;
            case 'vpc-endpoint': result = await resourceService.deleteVpcEndpoint(r.id, r.region); break;
          }
          return { ...r, success: true, action: result.action };
        } catch (err: any) {
          logger.error(`Bulk delete failed for ${r.type} ${r.id}: ${err.message}`);
          return { ...r, success: false, error: err.message };
        }
      }),
    );

    const failed = results.filter(r => !r.success);
    res.status(failed.length > 0 && failed.length === results.length ? 500 : 200).json({
      deleted: results.filter(r => r.success).length,
      failed: failed.length,
      results,
      deleted_by: user,
      timestamp: new Date().toISOString(),
    });
  });

  router.patch('/:type/:id/tags', async (req, res) => {
    const accountId = String(req.query.account ?? '');
    const services = resolver(accountId);
    if (!services) { res.status(400).json({ error: `Unknown account: ${accountId}` }); return; }
    const { type, id } = req.params;
    const region = String(req.query.region ?? 'us-east-1');
    const tags: Record<string, string> = req.body.tags ?? {};

    if (!VALID_TYPES.includes(type)) { res.status(400).json({ error: `Invalid resource type: ${type}` }); return; }
    if (!Object.keys(tags).length) { res.status(400).json({ error: 'tags object is required' }); return; }

    try {
      await services.resourceService.saveResourceTags(type, id, region, tags);
      await services.resourceService.patchCachedResourceTags(type, id, region, tags);
      res.json({ ok: true });
    } catch (err: any) {
      logger.error(`Failed to save tags for ${type} ${id}`, { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:type/:id', async (req, res) => {
    const accountId = String(req.query.account ?? '');
    const services = resolver(accountId);
    if (!services) { res.status(400).json({ error: `Unknown account: ${accountId}` }); return; }
    const resourceService = services.resourceService;
    const { type, id } = req.params;
    const region = String(req.query.region ?? 'us-east-1');
    const force = req.query.force === 'true';
    const user = (req as any).user?.userEntityRef ?? 'unknown';

    if (!VALID_TYPES.includes(type)) {
      res.status(400).json({ error: `Invalid resource type: ${type}` });
      return;
    }

    try {
      logger.info(`Deleting ${type} resource: ${id} in ${region}`, { deletedBy: user });

      let result: any;
      switch (type) {
        case 'ec2': result = await resourceService.deleteEC2(id, region); break;
        case 'ebs': result = await resourceService.deleteEBS(id, region); break;
        case 'rds': result = await resourceService.deleteRDS(id, region); break;
        case 'elb': result = await resourceService.deleteELB(id, region); break;
        case 'eip': result = await resourceService.releaseEIP(id, region); break;
        case 's3': result = force
          ? await resourceService.forceDeleteS3Bucket(id, region)
          : await resourceService.deleteS3Bucket(id, region); break;
        case 'vpc-endpoint': result = await resourceService.deleteVpcEndpoint(id, region); break;
      }

      res.json({
        success: true,
        resource_type: type,
        resource_id: id,
        region,
        action: result.action,
        deleted_by: user,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      logger.error(`Failed to delete ${type} ${id}`, { error: err.message });
      res.status(err.$metadata?.httpStatusCode === 409 ? 409 : 500).json({ error: err.message });
    }
  });

  return router;
}
