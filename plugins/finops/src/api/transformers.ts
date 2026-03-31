import {
  BackendMonthlyCostEntry, BackendServiceCostEntry, BackendTagCostEntry,
  BackendBudget, BackendUnusedResource, BackendRightsizingRecommendation, BackendCoverageData,
  MonthlyCostEntry, ServiceCostEntry, TagCostEntry,
  Budget, UnusedResource, RightsizingRecommendation, CoverageData, AccountInfo,
} from './types';

export function transformMonthlyCost(b: BackendMonthlyCostEntry): MonthlyCostEntry {
  return { month: b.month, totalCost: b.total_cost, currency: b.currency };
}

export function transformServiceCost(b: BackendServiceCostEntry): ServiceCostEntry {
  return { service: b.service, cost: b.cost };
}

export function transformTagCost(b: BackendTagCostEntry): TagCostEntry {
  return { tagValue: b.tag_value, cost: b.cost };
}

export function transformBudget(b: BackendBudget): Budget {
  return {
    name: b.name,
    budgetType: b.budget_type,
    limitAmount: b.limit_amount,
    limitUnit: b.limit_unit,
    actualSpend: b.actual_spend,
    forecastedSpend: b.forecasted_spend,
    timeUnit: b.time_unit,
    startDate: b.start_date,
    usagePercent: b.limit_amount > 0 ? (b.actual_spend / b.limit_amount) * 100 : 0,
  };
}

export function transformUnusedResource(b: BackendUnusedResource): UnusedResource {
  return {
    resourceType: b.resource_type,
    resourceId: b.resource_id,
    resourceName: b.resource_name,
    region: b.region,
    instanceType: b.instance_type,
    launchTime: b.launch_time,
    sizeGb: b.size_gb,
    engine: b.engine,
    volumeType: b.volume_type,
    state: b.state,
    avgCpuPercent: b.avg_cpu_percent,
    maxCpuPercent: b.max_cpu_percent,
    maxConnections: b.max_connections,
    totalRequests: b.total_requests,
    idleDays: b.idle_days,
    tags: b.tags,
    isWebsite: b.is_website,
    cdnDistributionIds: b.cdn_distribution_ids,
  };
}

export function transformRecommendation(b: BackendRightsizingRecommendation): RightsizingRecommendation {
  return {
    instanceId: b.instance_id,
    accountId: b.account_id,
    region: b.region,
    currentType: b.current_type,
    targetType: b.target_type,
    estimatedMonthlySavings: b.estimated_monthly_savings,
    currency: b.currency,
  };
}

export function transformCoverage(b: BackendCoverageData): CoverageData {
  return {
    coveragePercent: b.coverage_percent,
    onDemandCost: b.on_demand_cost,
    spendCoveredBySavingsPlans: b.spend_covered_by_savings_plans,
    onDemandHours: b.on_demand_hours,
    reservedHours: b.reserved_hours,
  };
}

export function transformAccountInfo(b: any): AccountInfo {
  return { accountId: b.account_id, arn: b.arn, userId: b.user_id };
}
