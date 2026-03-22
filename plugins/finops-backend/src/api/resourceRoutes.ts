import { Router } from 'express';
import { LoggerService } from '@backstage/backend-plugin-api';
import { ResourceService } from '../service/ResourceService';

const VALID_TYPES = ['ec2', 'ebs', 'rds', 'elb', 'eip', 's3', 'vpc-endpoint'];

type Resolver = (accountId: string) => { resourceService: ResourceService } | undefined;

export function createResourceRoutes(resolver: Resolver, logger: LoggerService): Router {
  const router = Router();

  router.get('/unused', async (req, res) => {
    const accountId = String(req.query.account ?? '');
    const services = resolver(accountId);
    if (!services) { res.status(400).json({ error: `Unknown account: ${accountId}` }); return; }
    const resourceService = services.resourceService;
    try {
      const region = String(req.query.region ?? 'us-east-1');
      const thresholdDays = req.query.thresholdDays ? parseInt(String(req.query.thresholdDays), 10) : undefined;
      logger.info(`Fetching unused resources in region: ${region}, threshold: ${thresholdDays ?? 'default'} days`);

      const [ec2, ebs, rds, elb, eip, s3, vpcEndpoints] = await Promise.all([
        resourceService.getUnusedEC2(region, thresholdDays).catch(e => { logger.warn(`EC2 scan failed: ${e.message}`); return []; }),
        resourceService.getUnusedEBS(region).catch(e => { logger.warn(`EBS scan failed: ${e.message}`); return []; }),
        resourceService.getUnusedRDS(region, thresholdDays).catch(e => { logger.warn(`RDS scan failed: ${e.message}`); return []; }),
        resourceService.getUnusedELB(region, thresholdDays).catch(e => { logger.warn(`ELB scan failed: ${e.message}`); return []; }),
        resourceService.getUnusedEIPs(region).catch(e => { logger.warn(`EIP scan failed: ${e.message}`); return []; }),
        resourceService.getUnusedS3(region).catch(e => { logger.warn(`S3 scan failed: ${e.message}`); return []; }),
        resourceService.getUnusedVpcEndpoints(region).catch(e => { logger.warn(`VPC Endpoint scan failed: ${e.message}`); return []; }),
      ]);

      res.json({ ec2, ebs, rds, elb, eip, s3, 'vpc-endpoint': vpcEndpoints, region });
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
