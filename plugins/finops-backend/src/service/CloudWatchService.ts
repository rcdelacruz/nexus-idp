import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { LoggerService } from '@backstage/backend-plugin-api';
import { AwsClientFactory } from './AwsClientFactory';

export class CloudWatchService {
  constructor(
    private readonly factory: AwsClientFactory,
    private readonly logger: LoggerService,
    private readonly idleThresholdDays: number,
  ) {}

  private getClient(region: string): CloudWatchClient {
    return this.factory.cloudwatch(region);
  }

  private getStartDate(thresholdDays?: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - (thresholdDays ?? this.idleThresholdDays));
    return d;
  }

  async checkEC2(instanceId: string, region: string, thresholdDays?: number): Promise<{ idle: boolean; avgCpu: number; maxCpu: number }> {
    try {
      const client = this.getClient(region);
      const res = await client.send(
        new GetMetricStatisticsCommand({
          Namespace: 'AWS/EC2',
          MetricName: 'CPUUtilization',
          Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
          StartTime: this.getStartDate(thresholdDays),
          EndTime: new Date(),
          Period: 604800,
          Statistics: ['Average', 'Maximum'],
        }),
      );
      const points = res.Datapoints ?? [];
      const avgCpu = points.length > 0 ? points.reduce((s, d) => s + (d.Average ?? 0), 0) / points.length : 0;
      const maxCpu = points.length > 0 ? Math.max(...points.map(d => d.Maximum ?? 0)) : 0;
      return { idle: maxCpu < 5, avgCpu: Math.round(avgCpu * 10) / 10, maxCpu: Math.round(maxCpu * 10) / 10 };
    } catch (err: any) {
      this.logger.warn(`CloudWatch EC2 check failed for ${instanceId}: ${err.message}`);
      return { idle: false, avgCpu: 0, maxCpu: 0 };
    }
  }

  async checkRDS(dbId: string, region: string, thresholdDays?: number): Promise<{ idle: boolean; maxConnections: number }> {
    try {
      const client = this.getClient(region);
      const res = await client.send(
        new GetMetricStatisticsCommand({
          Namespace: 'AWS/RDS',
          MetricName: 'DatabaseConnections',
          Dimensions: [{ Name: 'DBInstanceIdentifier', Value: dbId }],
          StartTime: this.getStartDate(thresholdDays),
          EndTime: new Date(),
          Period: 604800,
          Statistics: ['Maximum'],
        }),
      );
      const maxConnections = Math.max(...(res.Datapoints ?? []).map(d => d.Maximum ?? 0), 0);
      return { idle: maxConnections === 0, maxConnections };
    } catch (err: any) {
      this.logger.warn(`CloudWatch RDS check failed for ${dbId}: ${err.message}`);
      return { idle: false, maxConnections: 0 };
    }
  }

  async checkELB(lbArn: string, region: string, thresholdDays?: number): Promise<{ idle: boolean; totalRequests: number }> {
    try {
      const client = this.getClient(region);
      const lbName = lbArn.split('/').slice(-3).join('/');
      const res = await client.send(
        new GetMetricStatisticsCommand({
          Namespace: 'AWS/ApplicationELB',
          MetricName: 'RequestCount',
          Dimensions: [{ Name: 'LoadBalancer', Value: lbName }],
          StartTime: this.getStartDate(thresholdDays),
          EndTime: new Date(),
          Period: 604800,
          Statistics: ['Sum'],
        }),
      );
      const totalRequests = (res.Datapoints ?? []).reduce((sum, d) => sum + (d.Sum ?? 0), 0);
      return { idle: totalRequests === 0, totalRequests };
    } catch (err: any) {
      this.logger.warn(`CloudWatch ELB check failed for ${lbArn}: ${err.message}`);
      return { idle: false, totalRequests: 0 };
    }
  }

  // Keep backward-compatible aliases
  async isEC2Idle(instanceId: string, region: string, thresholdDays?: number): Promise<boolean> {
    return (await this.checkEC2(instanceId, region, thresholdDays)).idle;
  }
  async isRDSIdle(dbId: string, region: string, thresholdDays?: number): Promise<boolean> {
    return (await this.checkRDS(dbId, region, thresholdDays)).idle;
  }
  async isELBIdle(lbArn: string, region: string, thresholdDays?: number): Promise<boolean> {
    return (await this.checkELB(lbArn, region, thresholdDays)).idle;
  }
}
