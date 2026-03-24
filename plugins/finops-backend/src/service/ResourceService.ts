import {
  DescribeInstancesCommand,
  DescribeInstanceAttributeCommand,
  TerminateInstancesCommand,
  DescribeVolumesCommand,
  DeleteVolumeCommand,
  DescribeAddressesCommand,
  ReleaseAddressCommand,
  DescribeVpcEndpointsCommand,
  DeleteVpcEndpointsCommand,
  CreateTagsCommand,
} from '@aws-sdk/client-ec2';
import { DescribeTargetGroupsCommand, DescribeTargetHealthCommand } from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  ListBucketsCommand,
  ListObjectsV2Command,
  GetBucketLocationCommand,
  DeleteBucketCommand,
  GetBucketVersioningCommand,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import {
  DescribeDBInstancesCommand,
  DeleteDBInstanceCommand,
  AddTagsToResourceCommand,
} from '@aws-sdk/client-rds';
import {
  DescribeLoadBalancersCommand,
  DeleteLoadBalancerCommand,
  AddTagsCommand as AddELBTagsCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { PutBucketTaggingCommand, GetBucketTaggingCommand } from '@aws-sdk/client-s3';
import { LoggerService, CacheService } from '@backstage/backend-plugin-api';
import { ListDistributionsCommand } from '@aws-sdk/client-cloudfront';
import { GetBucketWebsiteCommand } from '@aws-sdk/client-s3';
import { AwsClientFactory } from './AwsClientFactory';

export interface UnusedResourceEntry {
  resource_type: 'ec2' | 'ebs' | 'rds' | 'elb' | 'eip' | 's3' | 'vpc-endpoint';
  resource_id: string;
  resource_name?: string;
  region: string;
  instance_type?: string;
  launch_time?: string;
  size_gb?: number;
  engine?: string;
  volume_type?: string;
  state?: string;
  avg_cpu_percent?: number;
  max_cpu_percent?: number;
  max_connections?: number;
  total_requests?: number;
  idle_days?: number;
  tags: Record<string, string>;
  // S3-specific
  is_website?: boolean;
  cdn_distribution_ids?: string[];
}

export class ResourceService {
  private readonly cachePrefix: string;
  // Track keys we've written so we can bulk-invalidate them
  private readonly cachedKeys = new Set<string>();

  constructor(
    private readonly factory: AwsClientFactory,
    private readonly logger: LoggerService,
    private readonly cache?: CacheService,
    private readonly cacheTtlMs = 86_400_000, // 24 hours default
    accountId = 'default',
  ) {
    this.cachePrefix = `${accountId}:resources:`;
  }

  async cachedScan<T extends object>(key: string, fn: () => Promise<T>): Promise<T> {
    if (!this.cache) {
      this.logger.info(`Resource cache: no cache service, scanning directly (key: ${key})`);
      return fn();
    }
    const prefixedKey = `${this.cachePrefix}${key}`;
    try {
      const cached = await this.cache.get<T>(prefixedKey);
      if (cached !== undefined) {
        this.logger.info(`Resource cache HIT: ${prefixedKey}`);
        return cached;
      }
    } catch (err: any) {
      this.logger.warn(`Resource cache get failed (${prefixedKey}): ${err.message} — scanning directly`);
      return fn();
    }
    this.logger.info(`Resource cache MISS: ${prefixedKey} — scanning AWS`);
    const data = await fn();
    try {
      await this.cache.set(prefixedKey, data as any, { ttl: this.cacheTtlMs });
      this.cachedKeys.add(prefixedKey);
      this.logger.info(`Resource cache SET: ${prefixedKey} (ttl: ${this.cacheTtlMs}ms)`);
    } catch (err: any) {
      this.logger.warn(`Resource cache set failed (${prefixedKey}): ${err.message}`);
    }
    return data;
  }

  async getActiveRegions(allRegions: string[]): Promise<string[]> {
    return this.cachedScan<{ regions: string[] }>(`active-regions`, async () => {
      // Check all resource types per region in parallel
      const regionResults = await Promise.all(
        allRegions.map(async region => {
          const ec2 = this.factory.ec2(region);
          const rds = this.factory.rds(region);
          const elb = this.factory.elb(region);
          const checks = await Promise.all([
            ec2.send(new DescribeInstancesCommand({ MaxResults: 5 }))
              .then(r => (r.Reservations ?? []).reduce((n, x) => n + (x.Instances?.length ?? 0), 0) > 0).catch(() => false),
            ec2.send(new DescribeVolumesCommand({ MaxResults: 5 }))
              .then(r => (r.Volumes ?? []).length > 0).catch(() => false),
            ec2.send(new DescribeAddressesCommand({}))
              .then(r => (r.Addresses ?? []).length > 0).catch(() => false),
            rds.send(new DescribeDBInstancesCommand({ MaxRecords: 5 }))
              .then(r => (r.DBInstances ?? []).length > 0).catch(() => false),
            elb.send(new DescribeLoadBalancersCommand({ PageSize: 5 }))
              .then(r => (r.LoadBalancers ?? []).length > 0).catch(() => false),
          ]);
          return { region, active: checks.some(Boolean) };
        }),
      );

      // S3 is global — check bucket locations separately
      const s3Client = this.factory.s3(allRegions[0]);
      const s3Regions = new Set<string>();
      try {
        const buckets = (await s3Client.send(new ListBucketsCommand({}))).Buckets ?? [];
        const locations = await Promise.all(
          buckets.map(b => s3Client.send(new GetBucketLocationCommand({ Bucket: b.Name ?? '' }))
            .then(r => r.LocationConstraint ?? 'us-east-1').catch(() => null)),
        );
        locations.filter(Boolean).forEach(r => s3Regions.add(r!));
      } catch { /* ignore */ }

      const active = new Set(regionResults.filter(r => r.active).map(r => r.region));
      s3Regions.forEach(r => active.add(r));
      return { regions: [...active].sort() };
    }).then(r => r.regions);
  }

  async saveResourceTags(type: string, id: string, region: string, tags: Record<string, string>): Promise<void> {
    const awsTags = Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
    switch (type) {
      case 'ec2':
      case 'ebs':
      case 'eip':
      case 'vpc-endpoint':
        await this.factory.ec2(region).send(new CreateTagsCommand({ Resources: [id], Tags: awsTags }));
        break;
      case 's3': {
        const s3 = this.factory.s3(region);
        // Merge with existing tags — PutBucketTagging replaces all
        let existing: { Key?: string; Value?: string }[] = [];
        try {
          const res = await s3.send(new GetBucketTaggingCommand({ Bucket: id }));
          existing = res.TagSet ?? [];
        } catch { /* no tags yet */ }
        const merged = { ...Object.fromEntries(existing.map(t => [t.Key!, t.Value!])), ...tags };
        await s3.send(new PutBucketTaggingCommand({ Bucket: id, Tagging: { TagSet: Object.entries(merged).map(([Key, Value]) => ({ Key, Value })) } }));
        break;
      }
      case 'rds':
        await this.factory.rds(region).send(new AddTagsToResourceCommand({ ResourceName: id, Tags: awsTags }));
        break;
      case 'elb':
        await this.factory.elb(region).send(new AddELBTagsCommand({ ResourceArns: [id], Tags: awsTags }));
        break;
      default:
        throw new Error(`Tagging not supported for type: ${type}`);
    }
  }

  async patchCachedResourceTags(type: string, id: string, region: string, tags: Record<string, string>): Promise<void> {
    if (!this.cache) return;
    const thresholds = ['all', '30', '60', '90', '180', '365', '730'];
    const regions = [region, 'all'];
    await Promise.all(
      regions.flatMap(r => thresholds.map(async t => {
        const key = `${this.cachePrefix}unused:${r}:${t}`;
        try {
          const cached = await this.cache!.get<any>(key);
          if (!cached) return;
          const list: any[] = cached[type] ?? [];
          const idx = list.findIndex((e: any) => e.resource_id === id);
          if (idx === -1) return;
          list[idx].tags = { ...list[idx].tags, ...tags };
          cached[type] = list;
          await this.cache!.set(key, cached, { ttl: this.cacheTtlMs });
        } catch { /* ignore */ }
      })),
    );
  }

  async invalidateCache(): Promise<void> {
    if (!this.cache) return;
    // Build all possible keys — regions + thresholds + special keys
    const allRegions = [
      'all', 'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
      'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
      'ap-south-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1',
      'sa-east-1', 'ca-central-1',
    ];
    const thresholds = ['all', '30', '60', '90', '180', '365', '730'];
    const allKeys: string[] = ['active-regions'];
    for (const region of allRegions) {
      for (const threshold of thresholds) {
        allKeys.push(`unused:${region}:${threshold}`);
      }
    }
    // Also delete any keys tracked in current session
    allKeys.push(...Array.from(this.cachedKeys).map(k => k.replace(this.cachePrefix, '')));
    const prefixed = [...new Set(allKeys.map(k => `${this.cachePrefix}${k}`))];
    await Promise.all(prefixed.map(k => this.cache!.delete(k).catch(() => {})));
    this.cachedKeys.clear();
    this.logger.info(`Resource cache invalidated — cleared ${prefixed.length} keys (prefix: ${this.cachePrefix})`);
  }

  private tagName(tags: { Key?: string; Value?: string }[] | undefined): string | undefined {
    return tags?.find(t => t.Key === 'Name')?.Value;
  }

  private tagsToMap(tags: { Key?: string; Value?: string }[] | undefined): Record<string, string> {
    return Object.fromEntries((tags ?? []).map(t => [t.Key ?? '', t.Value ?? '']));
  }

  private isOlderThan(date: Date | undefined, thresholdDays?: number): boolean {
    if (!date) return false;
    if (!thresholdDays) return true;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - thresholdDays);
    return date < cutoff;
  }

  private ageInDays(date: Date | undefined): number | undefined {
    if (!date) return undefined;
    return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  }

  async getUnusedEC2(region: string, thresholdDays?: number): Promise<UnusedResourceEntry[]> {
    const client = this.factory.ec2(region);
    const res = await client.send(
      new DescribeInstancesCommand({
        Filters: [{ Name: 'instance-state-name', Values: ['running', 'stopped'] }],
      }),
    );

    const instances = (res.Reservations ?? []).flatMap(r => r.Instances ?? []);
    return instances
      .filter(i => this.isOlderThan(i.LaunchTime, thresholdDays))
      .map(instance => ({
        resource_type: 'ec2' as const,
        resource_id: instance.InstanceId ?? '',
        resource_name: this.tagName(instance.Tags),
        region,
        instance_type: instance.InstanceType,
        launch_time: instance.LaunchTime?.toISOString(),
        state: instance.State?.Name,
        idle_days: this.ageInDays(instance.LaunchTime),
        tags: this.tagsToMap(instance.Tags),
      }));
  }

  async getUnusedEBS(region: string, thresholdDays?: number): Promise<UnusedResourceEntry[]> {
    const client = this.factory.ec2(region);
    const res = await client.send(
      new DescribeVolumesCommand({
        Filters: [{ Name: 'status', Values: ['available'] }],
      }),
    );

    return (res.Volumes ?? [])
      .filter(v => this.isOlderThan(v.CreateTime, thresholdDays))
      .map(v => ({
        resource_type: 'ebs' as const,
        resource_id: v.VolumeId ?? '',
        resource_name: this.tagName(v.Tags),
        region,
        size_gb: v.Size,
        volume_type: v.VolumeType,
        launch_time: v.CreateTime?.toISOString(),
        state: v.State,
        idle_days: this.ageInDays(v.CreateTime),
        tags: this.tagsToMap(v.Tags),
      }));
  }

  async getUnusedRDS(region: string, thresholdDays?: number): Promise<UnusedResourceEntry[]> {
    const client = this.factory.rds(region);
    const res = await client.send(new DescribeDBInstancesCommand({}));

    return (res.DBInstances ?? [])
      .filter(db => this.isOlderThan(db.InstanceCreateTime, thresholdDays))
      .map(db => ({
        resource_type: 'rds' as const,
        resource_id: db.DBInstanceIdentifier ?? '',
        resource_name: db.DBInstanceIdentifier,
        region,
        instance_type: db.DBInstanceClass,
        engine: `${db.Engine} ${db.EngineVersion ?? ''}`.trim(),
        launch_time: db.InstanceCreateTime?.toISOString(),
        state: db.DBInstanceStatus,
        size_gb: db.AllocatedStorage,
        idle_days: this.ageInDays(db.InstanceCreateTime),
        tags: this.tagsToMap(db.TagList),
      }));
  }

  async getUnusedELB(region: string, thresholdDays?: number): Promise<UnusedResourceEntry[]> {
    const client = this.factory.elb(region);
    const res = await client.send(new DescribeLoadBalancersCommand({}));

    return (res.LoadBalancers ?? [])
      .filter(lb => this.isOlderThan(lb.CreatedTime, thresholdDays))
      .map(lb => ({
        resource_type: 'elb' as const,
        resource_id: lb.LoadBalancerArn ?? '',
        resource_name: lb.LoadBalancerName,
        region,
        instance_type: lb.Type,
        launch_time: lb.CreatedTime?.toISOString(),
        state: lb.State?.Code,
        idle_days: this.ageInDays(lb.CreatedTime),
        tags: {},
      }));
  }

  async getUnusedEIPs(region: string): Promise<UnusedResourceEntry[]> {
    const client = this.factory.ec2(region);
    const res = await client.send(new DescribeAddressesCommand({}));

    return (res.Addresses ?? [])
      .filter(a => !a.AssociationId)
      .map(a => ({
        resource_type: 'eip' as const,
        resource_id: a.AllocationId ?? a.PublicIp ?? '',
        resource_name: a.PublicIp,
        region,
        tags: this.tagsToMap(a.Tags),
      }));
  }

  async deleteEC2(instanceId: string, region: string) {
    const client = this.factory.ec2(region);

    // Find any associated EIPs before terminating so we can release them after
    const eipRes = await client.send(new DescribeAddressesCommand({
      Filters: [{ Name: 'instance-id', Values: [instanceId] }],
    }));
    const eips = eipRes.Addresses ?? [];

    await client.send(new TerminateInstancesCommand({ InstanceIds: [instanceId] }));

    // Release associated EIPs — termination unassociates them but doesn't release (still billed)
    const releasedEips: string[] = [];
    for (const eip of eips) {
      if (eip.AllocationId) {
        try {
          await client.send(new ReleaseAddressCommand({ AllocationId: eip.AllocationId }));
          releasedEips.push(eip.PublicIp ?? eip.AllocationId);
        } catch (e: any) {
          this.logger.warn(`Could not release EIP ${eip.AllocationId}: ${e.message}`);
        }
      }
    }

    return {
      resource_id: instanceId,
      action: releasedEips.length > 0 ? `terminated + released EIPs: ${releasedEips.join(', ')}` : 'terminated',
    };
  }

  async deleteEBS(volumeId: string, region: string) {
    const client = this.factory.ec2(region);
    await client.send(new DeleteVolumeCommand({ VolumeId: volumeId }));
    return { resource_id: volumeId, action: 'deleted' };
  }

  async deleteRDS(dbInstanceId: string, region: string) {
    const client = this.factory.rds(region);
    await client.send(
      new DeleteDBInstanceCommand({
        DBInstanceIdentifier: dbInstanceId,
        SkipFinalSnapshot: true,
      }),
    );
    return { resource_id: dbInstanceId, action: 'deleted' };
  }

  async deleteELB(arn: string, region: string) {
    const client = this.factory.elb(region);
    await client.send(new DeleteLoadBalancerCommand({ LoadBalancerArn: arn }));
    return { resource_id: arn, action: 'deleted' };
  }

  async releaseEIP(allocationId: string, region: string) {
    const client = this.factory.ec2(region);
    await client.send(new ReleaseAddressCommand({ AllocationId: allocationId }));
    return { resource_id: allocationId, action: 'released' };
  }

  async getUnusedS3(region: string, _thresholdDays?: number): Promise<UnusedResourceEntry[]> {
    const client = this.factory.s3(region);
    const res = await client.send(new ListBucketsCommand({}));
    const buckets = res.Buckets ?? [];

    // Fetch CloudFront distributions once (global service) and build bucket-name → dist IDs map
    const cfClient = this.factory.cloudfront();
    const cfDistMap = new Map<string, string[]>();
    try {
      let marker: string | undefined;
      do {
        const cfRes = await cfClient.send(new ListDistributionsCommand({ Marker: marker }));
        const list = cfRes.DistributionList;
        for (const dist of list?.Items ?? []) {
          for (const origin of dist.Origins?.Items ?? []) {
            // S3 origins look like "bucket-name.s3.amazonaws.com" or "bucket-name.s3.region.amazonaws.com"
            const match = origin.DomainName?.match(/^([^.]+)\.s3[^.]*\.amazonaws\.com$/);
            if (match) {
              const bucketName = match[1];
              const existing = cfDistMap.get(bucketName) ?? [];
              existing.push(dist.Id ?? '');
              cfDistMap.set(bucketName, existing);
            }
          }
        }
        marker = list?.IsTruncated ? list.NextMarker : undefined;
      } while (marker);
    } catch (e: any) {
      this.logger.warn(`CloudFront list distributions failed: ${e.message}`);
    }

    // Run all GetBucketLocation + GetBucketWebsite calls in parallel
    // S3 CreationDate may reflect account migration date, so no date filter is applied.
    const results = await Promise.all(
      buckets.map(async bucket => {
        const name = bucket.Name ?? '';
        let bucketRegion = 'unknown';
        let isWebsite = false;
        try {
          const loc = await client.send(new GetBucketLocationCommand({ Bucket: name }));
          bucketRegion = loc.LocationConstraint ?? 'us-east-1';
        } catch {
          // leave as unknown
        }
        let isEmpty: boolean | undefined;
        if (bucketRegion === region) {
          try {
            await client.send(new GetBucketWebsiteCommand({ Bucket: name }));
            isWebsite = true;
          } catch {
            // NoSuchWebsiteConfiguration or AccessDenied → not a website
          }
          try {
            const regionalClient = this.factory.s3(bucketRegion);
            const obj = await regionalClient.send(new ListObjectsV2Command({ Bucket: name, MaxKeys: 1 }));
            isEmpty = (obj.KeyCount ?? 0) === 0;
          } catch {
            // AccessDenied or other — leave undefined
          }
        }
        return { bucket, bucketRegion, isWebsite, isEmpty };
      }),
    );
    const inRegion = results.filter(r => r.bucketRegion === region);

    return inRegion.map(({ bucket, isWebsite, isEmpty }) => ({
      resource_type: 's3' as const,
      resource_id: bucket.Name ?? '',
      resource_name: bucket.Name,
      region,
      launch_time: bucket.CreationDate?.toISOString(),
      state: isEmpty === true ? 'empty' : isEmpty === false ? 'has-objects' : 'unknown',
      idle_days: this.ageInDays(bucket.CreationDate),
      tags: {},
      is_website: isWebsite || undefined,
      cdn_distribution_ids: cfDistMap.has(bucket.Name ?? '') ? cfDistMap.get(bucket.Name ?? '') : undefined,
    }));
  }

  async getUnusedVpcEndpoints(region: string, thresholdDays?: number): Promise<UnusedResourceEntry[]> {
    const client = this.factory.ec2(region);
    const res = await client.send(
      new DescribeVpcEndpointsCommand({
        Filters: [{ Name: 'vpc-endpoint-state', Values: ['available'] }],
      }),
    );

    return (res.VpcEndpoints ?? [])
      .filter(ep =>
        (ep.RouteTableIds ?? []).length === 0 &&
        (ep.NetworkInterfaceIds ?? []).length === 0 &&
        this.isOlderThan(ep.CreationTimestamp, thresholdDays),
      )
      .map(ep => ({
        resource_type: 'vpc-endpoint' as const,
        resource_id: ep.VpcEndpointId ?? '',
        resource_name: ep.ServiceName,
        region,
        instance_type: ep.VpcEndpointType,
        launch_time: ep.CreationTimestamp?.toISOString(),
        state: ep.State,
        idle_days: this.ageInDays(ep.CreationTimestamp),
        tags: this.tagsToMap(ep.Tags),
      }));
  }

  async checkDependencies(type: string, id: string, region: string): Promise<{
    blockers: string[];
    warnings: string[];
    info: string[];
    safe: boolean;
  }> {
    const blockers: string[] = [];
    const warnings: string[] = [];
    const info: string[] = [];

    try {
      if (type === 'ec2') {
        const ec2 = this.factory.ec2(region);
        const res = await ec2.send(new DescribeInstancesCommand({ InstanceIds: [id] }));
        const instance = res.Reservations?.[0]?.Instances?.[0];
        if (instance) {
          // Check termination protection
          const attr = await ec2.send(new DescribeInstanceAttributeCommand({ InstanceId: id, Attribute: 'disableApiTermination' }));
          if (attr.DisableApiTermination?.Value) blockers.push('Termination protection is enabled — disable it first in the AWS Console.');
          // Check if in ASG
          const asgTag = instance.Tags?.find(t => t.Key === 'aws:autoscaling:groupName');
          if (asgTag?.Value) blockers.push(`Part of Auto Scaling Group: ${asgTag.Value} — remove from ASG first.`);
          // Check attached EBS volumes
          const vols = (instance.BlockDeviceMappings ?? []).filter(b => b.Ebs?.VolumeId && !b.DeviceName?.includes('sda') && !b.DeviceName?.includes('xvda'));
          if (vols.length > 0) warnings.push(`${vols.length} non-root EBS volume(s) attached — they will be deleted if DeleteOnTermination is set.`);
          // Check associated EIPs
          const eips = await ec2.send(new DescribeAddressesCommand({ Filters: [{ Name: 'instance-id', Values: [id] }] }));
          if ((eips.Addresses ?? []).length > 0) info.push(`${eips.Addresses!.length} associated Elastic IP(s) will be automatically released.`);
        }
      } else if (type === 'rds') {
        const rds = this.factory.rds(region);
        const res = await rds.send(new DescribeDBInstancesCommand({ DBInstanceIdentifier: id }));
        const db = res.DBInstances?.[0];
        if (db) {
          if (db.DeletionProtection) blockers.push('Deletion protection is enabled — disable it first in RDS settings.');
          if ((db.ReadReplicaDBInstanceIdentifiers ?? []).length > 0) blockers.push(`Has ${db.ReadReplicaDBInstanceIdentifiers!.length} read replica(s) — delete them first.`);
          if (db.MultiAZ) warnings.push('Multi-AZ instance — both primary and standby will be deleted.');
          if (db.BackupRetentionPeriod && db.BackupRetentionPeriod > 0) warnings.push(`Automated backups will be deleted (retention: ${db.BackupRetentionPeriod} days). Consider taking a final snapshot.`);
        }
      } else if (type === 'elb') {
        const elb = this.factory.elb(region);
        const tgRes = await elb.send(new DescribeTargetGroupsCommand({ LoadBalancerArn: id }));
        for (const tg of tgRes.TargetGroups ?? []) {
          const health = await elb.send(new DescribeTargetHealthCommand({ TargetGroupArn: tg.TargetGroupArn }));
          const healthy = (health.TargetHealthDescriptions ?? []).filter(t => t.TargetHealth?.State === 'healthy').length;
          if (healthy > 0) blockers.push(`Target group "${tg.TargetGroupName}" has ${healthy} healthy target(s) still registered.`);
          else if ((health.TargetHealthDescriptions ?? []).length > 0) warnings.push(`Target group "${tg.TargetGroupName}" has registered targets (all unhealthy).`);
        }
      } else if (type === 's3') {
        const s3 = this.factory.s3(region);
        const versioning = await s3.send(new GetBucketVersioningCommand({ Bucket: id }));
        if (versioning.Status === 'Enabled' || versioning.Status === 'Suspended') {
          blockers.push(`Bucket versioning is ${versioning.Status} — delete all versions and delete markers first, or use the AWS Console.`);
        }
        const objects = await s3.send(new ListObjectsV2Command({ Bucket: id, MaxKeys: 1 }));
        if ((objects.KeyCount ?? 0) > 0) blockers.push('Bucket is not empty — use Force Delete to automatically empty and remove it.');
      } else if (type === 'vpc-endpoint') {
        const ec2 = this.factory.ec2(region);
        const res = await ec2.send(new DescribeVpcEndpointsCommand({ VpcEndpointIds: [id] }));
        const ep = res.VpcEndpoints?.[0];
        if (ep) {
          if ((ep.RouteTableIds ?? []).length > 0) warnings.push(`Still associated with ${ep.RouteTableIds!.length} route table(s).`);
          if ((ep.NetworkInterfaceIds ?? []).length > 0) warnings.push(`Has ${ep.NetworkInterfaceIds!.length} network interface(s) — they will be deleted.`);
        }
      }
    } catch (err: any) {
      this.logger.warn(`Dependency check failed for ${type} ${id}: ${err.message}`);
      warnings.push(`Could not fully check dependencies: ${err.message}`);
    }

    return { blockers, warnings, info, safe: blockers.length === 0 };
  }

  async forceDeleteS3Bucket(name: string, region: string) {
    const client = this.factory.s3(region);
    // Delete all versions and delete markers in batches of 1000
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    do {
      const res = await client.send(new ListObjectVersionsCommand({
        Bucket: name,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
      }));
      const objects = [
        ...(res.Versions ?? []).map(v => ({ Key: v.Key!, VersionId: v.VersionId! })),
        ...(res.DeleteMarkers ?? []).map(d => ({ Key: d.Key!, VersionId: d.VersionId! })),
      ];
      if (objects.length > 0) {
        await client.send(new DeleteObjectsCommand({
          Bucket: name,
          Delete: { Objects: objects, Quiet: true },
        }));
      }
      keyMarker = res.NextKeyMarker;
      versionIdMarker = res.NextVersionIdMarker;
    } while (keyMarker || versionIdMarker);

    await client.send(new DeleteBucketCommand({ Bucket: name }));
    return { resource_id: name, action: 'force-deleted' };
  }

  async deleteS3Bucket(name: string, region: string) {
    const client = this.factory.s3(region);
    await client.send(new DeleteBucketCommand({ Bucket: name }));
    return { resource_id: name, action: 'deleted' };
  }

  async deleteVpcEndpoint(endpointId: string, region: string) {
    const client = this.factory.ec2(region);
    await client.send(new DeleteVpcEndpointsCommand({ VpcEndpointIds: [endpointId] }));
    return { resource_id: endpointId, action: 'deleted' };
  }
}
