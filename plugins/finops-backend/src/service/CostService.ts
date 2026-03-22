import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostAndUsageCommandInput,
  GetRightsizingRecommendationCommand,
  GetSavingsPlansCoverageCommand,
  GetReservationCoverageCommand,
} from '@aws-sdk/client-cost-explorer';
import { BudgetsClient, DescribeBudgetsCommand } from '@aws-sdk/client-budgets';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { LoggerService, CacheService } from '@backstage/backend-plugin-api';
import { AwsClientFactory } from './AwsClientFactory';
import { MetadataStore } from './MetadataStore';

export class CostService {
  private readonly cacheTtlSeconds: number;
  private readonly cachePrefix: string;
  private readonly ceClient: CostExplorerClient;
  private readonly budgetsClient: BudgetsClient;
  private readonly stsClient: STSClient;

  constructor(
    factory: AwsClientFactory,
    private readonly logger: LoggerService,
    private readonly cache: CacheService,
    private readonly metadataStore: MetadataStore,
    cacheTtlSeconds = 300,
    accountId = 'default',
  ) {
    this.cacheTtlSeconds = cacheTtlSeconds;
    this.cachePrefix = `${accountId}:`;
    this.ceClient = factory.costExplorer();
    this.budgetsClient = factory.budgets();
    this.stsClient = factory.sts();
  }

  async invalidateCache(): Promise<void> {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 1);
    const startStr = this.formatDate(start);
    const endStr = this.formatDate(end);

    const keys = [
      'account-info', 'budgets', 'rightsizing',
      'savings-plans-coverage', 'ri-coverage',
      ...[1, 3, 6, 12].map(m => `monthly-trend-${m}`),
      `cost-by-service-${startStr}-${endStr}`,
      ...['team', 'project', 'env'].map(k => `cost-by-tag-${k}-${startStr}-${endStr}`),
    ].map(k => `${this.cachePrefix}${k}`);
    await Promise.all(keys.map(k => this.cache.delete(k)));
    this.logger.info(`FinOps cache invalidated for account prefix: ${this.cachePrefix}`);
  }

  async getLastFetchedAt(): Promise<string | null> {
    return this.metadataStore.get('last_fetched_at');
  }

  private async cachedCall<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prefixedKey = `${this.cachePrefix}${key}`;
    const cached = await this.cache.get<any>(prefixedKey);
    if (cached !== undefined) {
      this.logger.debug(`Cache hit: ${prefixedKey}`);
      return cached as T;
    }
    const data = await fn();
    await this.cache.set(prefixedKey, data as any, { ttl: this.cacheTtlSeconds * 1000 });
    await this.metadataStore.set('last_fetched_at', new Date().toISOString());
    return data;
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  async getAccountInfo() {
    return this.cachedCall('account-info', async () => {
      const res = await this.stsClient.send(new GetCallerIdentityCommand({}));
      return {
        account_id: res.Account ?? 'unknown',
        arn: res.Arn ?? 'unknown',
        user_id: res.UserId ?? 'unknown',
      };
    });
  }

  async getMonthlyCostTrend(months = 6) {
    const key = `monthly-trend-${months}`;
    return this.cachedCall(key, async () => {
      const end = new Date();
      const start = new Date();
      start.setMonth(start.getMonth() - months);

      const input: GetCostAndUsageCommandInput = {
        TimePeriod: {
          Start: this.formatDate(start),
          End: this.formatDate(end),
        },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
      };

      const res = await this.ceClient.send(new GetCostAndUsageCommand(input));
      return (res.ResultsByTime ?? []).map(r => ({
        month: r.TimePeriod?.Start?.slice(0, 7) ?? '',
        total_cost: parseFloat(r.Total?.UnblendedCost?.Amount ?? '0'),
        currency: r.Total?.UnblendedCost?.Unit ?? 'USD',
      }));
    });
  }

  async getCostByService(start: string, end: string) {
    const key = `cost-by-service-${start}-${end}`;
    return this.cachedCall(key, async () => {
      const input: GetCostAndUsageCommandInput = {
        TimePeriod: { Start: start, End: end },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      };

      const res = await this.ceClient.send(new GetCostAndUsageCommand(input));
      const serviceMap = new Map<string, number>();

      for (const result of res.ResultsByTime ?? []) {
        for (const group of result.Groups ?? []) {
          const service = group.Keys?.[0] ?? 'Unknown';
          const cost = parseFloat(group.Metrics?.UnblendedCost?.Amount ?? '0');
          serviceMap.set(service, (serviceMap.get(service) ?? 0) + cost);
        }
      }

      return Array.from(serviceMap.entries())
        .map(([service, cost]) => ({ service, cost }))
        .sort((a, b) => b.cost - a.cost);
    });
  }

  async getCostByTag(tagKey: string, start: string, end: string) {
    const key = `cost-by-tag-${tagKey}-${start}-${end}`;
    return this.cachedCall(key, async () => {
      const input: GetCostAndUsageCommandInput = {
        TimePeriod: { Start: start, End: end },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'TAG', Key: tagKey }],
      };

      const res = await this.ceClient.send(new GetCostAndUsageCommand(input));
      const tagMap = new Map<string, number>();

      for (const result of res.ResultsByTime ?? []) {
        for (const group of result.Groups ?? []) {
          const rawKey = group.Keys?.[0] ?? '';
          const tagValue = rawKey.startsWith(`${tagKey}$`)
            ? rawKey.slice(tagKey.length + 1)
            : rawKey || 'Untagged';
          const cost = parseFloat(group.Metrics?.UnblendedCost?.Amount ?? '0');
          tagMap.set(tagValue, (tagMap.get(tagValue) ?? 0) + cost);
        }
      }

      return Array.from(tagMap.entries())
        .map(([tag_value, cost]) => ({ tag_value, cost }))
        .sort((a, b) => b.cost - a.cost);
    });
  }

  async getBudgets() {
    return this.cachedCall('budgets', async () => {
      const accountInfo = await this.getAccountInfo();
      const res = await this.budgetsClient.send(
        new DescribeBudgetsCommand({ AccountId: accountInfo.account_id }),
      );

      return (res.Budgets ?? []).map(b => ({
        name: b.BudgetName ?? '',
        budget_type: b.BudgetType ?? '',
        limit_amount: parseFloat(b.BudgetLimit?.Amount ?? '0'),
        limit_unit: b.BudgetLimit?.Unit ?? 'USD',
        actual_spend: parseFloat(b.CalculatedSpend?.ActualSpend?.Amount ?? '0'),
        forecasted_spend: b.CalculatedSpend?.ForecastedSpend?.Amount
          ? parseFloat(b.CalculatedSpend.ForecastedSpend.Amount)
          : undefined,
        time_unit: b.TimeUnit ?? '',
        start_date: b.TimePeriod?.Start?.toISOString().slice(0, 10) ?? '',
      }));
    });
  }

  async getRightsizingRecommendations() {
    return this.cachedCall('rightsizing', async () => {
      const res = await this.ceClient.send(
        new GetRightsizingRecommendationCommand({ Service: 'AmazonEC2' }),
      );

      return (res.RightsizingRecommendations ?? []).map(r => ({
        instance_id: r.CurrentInstance?.ResourceId ?? '',
        account_id: r.AccountId ?? '',
        current_type: r.CurrentInstance?.ResourceDetails?.EC2ResourceDetails?.InstanceType ?? '',
        target_type:
          r.RightsizingType === 'MODIFY'
            ? (r.ModifyRecommendationDetail?.TargetInstances?.[0]?.ResourceDetails
                ?.EC2ResourceDetails?.InstanceType ?? '')
            : 'Terminate',
        estimated_monthly_savings: parseFloat(
          r.ModifyRecommendationDetail?.TargetInstances?.[0]?.EstimatedMonthlySavings ?? '0',
        ),
        currency: 'USD',
      }));
    });
  }

  async getSavingsPlansCoverage() {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 1);

    return this.cachedCall('savings-plans-coverage', async () => {
      const res = await this.ceClient.send(
        new GetSavingsPlansCoverageCommand({
          TimePeriod: {
            Start: this.formatDate(start),
            End: this.formatDate(end),
          },
        }),
      );

      // Aggregate totals across all time periods
      let onDemandCost = 0;
      let spendCovered = 0;
      for (const entry of res.SavingsPlansCoverages ?? []) {
        onDemandCost += parseFloat(entry.Coverage?.OnDemandCost ?? '0');
        spendCovered += parseFloat(entry.Coverage?.SpendCoveredBySavingsPlans ?? '0');
      }
      const totalSpend = onDemandCost + spendCovered;
      return {
        coverage_percent: totalSpend > 0 ? (spendCovered / totalSpend) * 100 : 0,
        on_demand_cost: onDemandCost,
        spend_covered_by_savings_plans: spendCovered,
      };
    });
  }

  async getReservedInstanceCoverage() {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 1);

    return this.cachedCall('ri-coverage', async () => {
      const res = await this.ceClient.send(
        new GetReservationCoverageCommand({
          TimePeriod: {
            Start: this.formatDate(start),
            End: this.formatDate(end),
          },
        }),
      );

      const total = res.Total;
      return {
        coverage_percent: parseFloat(total?.CoverageHours?.CoverageHoursPercentage ?? '0'),
        on_demand_hours: parseFloat(total?.CoverageHours?.OnDemandHours ?? '0'),
        reserved_hours: parseFloat(total?.CoverageHours?.ReservedHours ?? '0'),
      };
    });
  }
}
