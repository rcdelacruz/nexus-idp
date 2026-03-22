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
} from '@aws-sdk/client-rds';
import {
  DescribeLoadBalancersCommand,
  DeleteLoadBalancerCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { LoggerService } from '@backstage/backend-plugin-api';
import { AwsClientFactory } from './AwsClientFactory';
import { CloudWatchService } from './CloudWatchService';

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
}

export class ResourceService {
  constructor(
    private readonly factory: AwsClientFactory,
    private readonly cloudwatch: CloudWatchService,
    private readonly logger: LoggerService,
  ) {}

  private tagName(tags: { Key?: string; Value?: string }[] | undefined): string | undefined {
    return tags?.find(t => t.Key === 'Name')?.Value;
  }

  private tagsToMap(tags: { Key?: string; Value?: string }[] | undefined): Record<string, string> {
    return Object.fromEntries((tags ?? []).map(t => [t.Key ?? '', t.Value ?? '']));
  }

  async getUnusedEC2(region: string, thresholdDays?: number): Promise<UnusedResourceEntry[]> {
    const client = this.factory.ec2(region);
    const res = await client.send(
      new DescribeInstancesCommand({
        Filters: [{ Name: 'instance-state-name', Values: ['running', 'stopped'] }],
      }),
    );

    const instances = (res.Reservations ?? []).flatMap(r => r.Instances ?? []);
    const checks = await Promise.all(
      instances.map(instance => this.cloudwatch.checkEC2(instance.InstanceId ?? '', region, thresholdDays)),
    );
    return instances.reduce<UnusedResourceEntry[]>((acc, instance, i) => {
      if (checks[i].idle) {
        acc.push({
          resource_type: 'ec2',
          resource_id: instance.InstanceId ?? '',
          resource_name: this.tagName(instance.Tags),
          region,
          instance_type: instance.InstanceType,
          launch_time: instance.LaunchTime?.toISOString(),
          state: instance.State?.Name,
          avg_cpu_percent: checks[i].avgCpu,
          max_cpu_percent: checks[i].maxCpu,
          idle_days: thresholdDays,
          tags: this.tagsToMap(instance.Tags),
        });
      }
      return acc;
    }, []);
  }

  async getUnusedEBS(region: string): Promise<UnusedResourceEntry[]> {
    const client = this.factory.ec2(region);
    const res = await client.send(
      new DescribeVolumesCommand({
        Filters: [{ Name: 'status', Values: ['available'] }],
      }),
    );

    return (res.Volumes ?? []).map(v => ({
      resource_type: 'ebs' as const,
      resource_id: v.VolumeId ?? '',
      resource_name: this.tagName(v.Tags),
      region,
      size_gb: v.Size,
      volume_type: v.VolumeType,
      launch_time: v.CreateTime?.toISOString(),
      state: v.State,
      tags: this.tagsToMap(v.Tags),
    }));
  }

  async getUnusedRDS(region: string, thresholdDays?: number): Promise<UnusedResourceEntry[]> {
    const client = this.factory.rds(region);
    const res = await client.send(new DescribeDBInstancesCommand({}));

    const dbs = res.DBInstances ?? [];
    const checks = await Promise.all(
      dbs.map(db => this.cloudwatch.checkRDS(db.DBInstanceIdentifier ?? '', region, thresholdDays)),
    );
    return dbs.reduce<UnusedResourceEntry[]>((acc, db, i) => {
      if (checks[i].idle) {
        acc.push({
          resource_type: 'rds',
          resource_id: db.DBInstanceIdentifier ?? '',
          resource_name: db.DBInstanceIdentifier,
          region,
          instance_type: db.DBInstanceClass,
          engine: `${db.Engine} ${db.EngineVersion ?? ''}`.trim(),
          launch_time: db.InstanceCreateTime?.toISOString(),
          state: db.DBInstanceStatus,
          size_gb: db.AllocatedStorage,
          max_connections: checks[i].maxConnections,
          idle_days: thresholdDays,
          tags: this.tagsToMap(db.TagList),
        });
      }
      return acc;
    }, []);
  }

  async getUnusedELB(region: string, thresholdDays?: number): Promise<UnusedResourceEntry[]> {
    const client = this.factory.elb(region);
    const res = await client.send(new DescribeLoadBalancersCommand({}));

    const lbs = res.LoadBalancers ?? [];
    const checks = await Promise.all(
      lbs.map(lb => this.cloudwatch.checkELB(lb.LoadBalancerArn ?? '', region, thresholdDays)),
    );
    return lbs.reduce<UnusedResourceEntry[]>((acc, lb, i) => {
      if (checks[i].idle) {
        acc.push({
          resource_type: 'elb',
          resource_id: lb.LoadBalancerArn ?? '',
          resource_name: lb.LoadBalancerName,
          region,
          instance_type: lb.Type,
          launch_time: lb.CreatedTime?.toISOString(),
          state: lb.State?.Code,
          total_requests: checks[i].totalRequests,
          idle_days: thresholdDays,
          tags: {},
        });
      }
      return acc;
    }, []);
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
    await client.send(new TerminateInstancesCommand({ InstanceIds: [instanceId] }));
    return { resource_id: instanceId, action: 'terminated' };
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

  async getUnusedS3(region: string): Promise<UnusedResourceEntry[]> {
    const client = this.factory.s3(region);
    const res = await client.send(new ListBucketsCommand({}));
    const buckets = res.Buckets ?? [];
    const results = await Promise.all(
      buckets.map(async bucket => {
        const name = bucket.Name ?? '';
        try {
          const locationRes = await client.send(new GetBucketLocationCommand({ Bucket: name }));
          const bucketRegion = locationRes.LocationConstraint ?? 'us-east-1';
          if (bucketRegion !== region) return null;

          const objects = await client.send(new ListObjectsV2Command({ Bucket: name, MaxKeys: 1 }));
          if ((objects.KeyCount ?? 0) === 0) {
            return {
              resource_type: 's3' as const,
              resource_id: name,
              resource_name: name,
              region,
              launch_time: bucket.CreationDate?.toISOString(),
              state: 'empty',
              tags: {},
            };
          }
        } catch (err: any) {
          this.logger.warn(`S3 check failed for bucket ${name}: ${err.message}`);
        }
        return null;
      }),
    );
    return results.filter(Boolean) as UnusedResourceEntry[];
  }

  async getUnusedVpcEndpoints(region: string): Promise<UnusedResourceEntry[]> {
    const client = this.factory.ec2(region);
    const res = await client.send(
      new DescribeVpcEndpointsCommand({
        Filters: [{ Name: 'vpc-endpoint-state', Values: ['available'] }],
      }),
    );

    return (res.VpcEndpoints ?? [])
      .filter(ep => (ep.RouteTableIds ?? []).length === 0 && (ep.NetworkInterfaceIds ?? []).length === 0)
      .map(ep => ({
        resource_type: 'vpc-endpoint' as const,
        resource_id: ep.VpcEndpointId ?? '',
        resource_name: ep.ServiceName,
        region,
        instance_type: ep.VpcEndpointType,
        launch_time: ep.CreationTimestamp?.toISOString(),
        state: ep.State,
        tags: this.tagsToMap(ep.Tags),
      }));
  }

  async checkDependencies(type: string, id: string, region: string): Promise<{
    blockers: string[];
    warnings: string[];
    safe: boolean;
  }> {
    const blockers: string[] = [];
    const warnings: string[] = [];

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
          if ((eips.Addresses ?? []).length > 0) warnings.push('Has an associated Elastic IP — it will become unassociated but not released.');
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
        if ((objects.KeyCount ?? 0) > 0) blockers.push('Bucket is not empty — delete all objects first.');
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

    return { blockers, warnings, safe: blockers.length === 0 };
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
