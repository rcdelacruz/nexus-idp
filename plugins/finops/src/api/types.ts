// ─── Backend types (snake_case, as returned by API) ──────────────────────────

export interface BackendMonthlyCostEntry {
  month: string;
  total_cost: number;
  currency: string;
}

export interface BackendServiceCostEntry {
  service: string;
  cost: number;
}

export interface BackendTagCostEntry {
  tag_value: string;
  cost: number;
}

export interface BackendBudget {
  name: string;
  budget_type: string;
  limit_amount: number;
  limit_unit: string;
  actual_spend: number;
  forecasted_spend?: number;
  time_unit: string;
  start_date: string;
}

export interface BackendUnusedResource {
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
  is_website?: boolean;
  cdn_distribution_ids?: string[];
}

export interface BackendRightsizingRecommendation {
  instance_id: string;
  account_id: string;
  region: string;
  current_type: string;
  target_type: string;
  estimated_monthly_savings: number;
  currency: string;
}

export interface BackendCoverageData {
  coverage_percent: number;
  on_demand_cost?: number;
  spend_covered_by_savings_plans?: number;
  on_demand_hours?: number;
  reserved_hours?: number;
}

export interface BackendUnusedResourcesResponse {
  ec2: BackendUnusedResource[];
  ebs: BackendUnusedResource[];
  rds: BackendUnusedResource[];
  elb: BackendUnusedResource[];
  eip: BackendUnusedResource[];
  region: string;
}

// ─── Frontend types (camelCase) ───────────────────────────────────────────────

export interface MonthlyCostEntry {
  month: string;
  totalCost: number;
  currency: string;
}

export interface ServiceCostEntry {
  service: string;
  cost: number;
}

export interface TagCostEntry {
  tagValue: string;
  cost: number;
}

export interface Budget {
  name: string;
  budgetType: string;
  limitAmount: number;
  limitUnit: string;
  actualSpend: number;
  forecastedSpend?: number;
  timeUnit: string;
  startDate: string;
  usagePercent: number;
}

export interface UnusedResource {
  resourceType: 'ec2' | 'ebs' | 'rds' | 'elb' | 'eip' | 's3' | 'vpc-endpoint';
  resourceId: string;
  resourceName?: string;
  region: string;
  instanceType?: string;
  launchTime?: string;
  sizeGb?: number;
  engine?: string;
  volumeType?: string;
  state?: string;
  avgCpuPercent?: number;
  maxCpuPercent?: number;
  maxConnections?: number;
  totalRequests?: number;
  idleDays?: number;
  tags: Record<string, string>;
  isWebsite?: boolean;
  cdnDistributionIds?: string[];
}

export interface UnusedResourcesData {
  ec2: UnusedResource[];
  ebs: UnusedResource[];
  rds: UnusedResource[];
  elb: UnusedResource[];
  eip: UnusedResource[];
  s3: UnusedResource[];
  'vpc-endpoint': UnusedResource[];
  regions: string[];
  timedOutRegions: string[];
}

export interface RightsizingRecommendation {
  instanceId: string;
  accountId: string;
  region: string;
  currentType: string;
  targetType: string;
  estimatedMonthlySavings: number;
  currency: string;
}

export interface CoverageData {
  coveragePercent: number;
  onDemandCost?: number;
  spendCoveredBySavingsPlans?: number;
  onDemandHours?: number;
  reservedHours?: number;
}

export interface AccountInfo {
  accountId: string;
  arn: string;
  userId: string;
}

export interface AwsAccount {
  id: string;
  name: string;
}
