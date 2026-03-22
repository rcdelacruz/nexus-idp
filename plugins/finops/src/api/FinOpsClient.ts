import { createApiRef, DiscoveryApi, IdentityApi } from '@backstage/core-plugin-api';
import {
  MonthlyCostEntry, ServiceCostEntry, TagCostEntry,
  Budget, UnusedResourcesData, RightsizingRecommendation, CoverageData, AccountInfo, AwsAccount,
} from './types';
import {
  transformMonthlyCost, transformServiceCost, transformTagCost,
  transformBudget, transformUnusedResource, transformRecommendation,
  transformCoverage, transformAccountInfo,
} from './transformers';

export const finopsApiRef = createApiRef<FinOpsApi>({
  id: 'plugin.finops.service',
});

export interface FinOpsApi {
  getAccounts(): Promise<AwsAccount[]>;
  getAccountInfo(accountId?: string): Promise<AccountInfo & { lastFetchedAt: string | null }>;
  getMonthlyCostTrend(months?: number, accountId?: string): Promise<MonthlyCostEntry[]>;
  getCostByService(start: string, end: string, accountId?: string): Promise<ServiceCostEntry[]>;
  getCostByTag(tagKey: string, start: string, end: string, accountId?: string): Promise<TagCostEntry[]>;
  getBudgets(accountId?: string): Promise<Budget[]>;
  getUnusedResources(region: string, thresholdDays?: number, accountId?: string): Promise<UnusedResourcesData>;
  deleteResource(resourceType: string, resourceId: string, region: string, force?: boolean, accountId?: string): Promise<void>;
  bulkDeleteResources(resources: { type: string; id: string; region: string }[], accountId?: string): Promise<{ deleted: number; failed: number }>;
  checkDependencies(resourceType: string, resourceId: string, region: string, accountId?: string): Promise<{ blockers: string[]; warnings: string[]; safe: boolean }>;
  getRightsizingRecommendations(accountId?: string): Promise<RightsizingRecommendation[]>;
  getSavingsPlansCoverage(accountId?: string): Promise<CoverageData>;
  getReservedInstanceCoverage(accountId?: string): Promise<CoverageData>;
  invalidateCache(accountId?: string): Promise<void>;
}

export class FinOpsClient implements FinOpsApi {
  constructor(
    private readonly discoveryApi: DiscoveryApi,
    private readonly identityApi: IdentityApi,
  ) {}

  private async getBaseUrl(): Promise<string> {
    return this.discoveryApi.getBaseUrl('finops');
  }

  private async headers(): Promise<HeadersInit> {
    const { token } = await this.identityApi.getCredentials();
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const baseUrl = await this.getBaseUrl();
    const headers = await this.headers();
    const res = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error ?? res.statusText);
    }
    return res.json();
  }

  private acct(accountId?: string) {
    return accountId ? `&account=${encodeURIComponent(accountId)}` : '';
  }

  async getAccounts(): Promise<AwsAccount[]> {
    const data = await this.fetch<{ accounts: AwsAccount[] }>('/accounts');
    return data.accounts;
  }

  async getAccountInfo(accountId?: string): Promise<AccountInfo & { lastFetchedAt: string | null }> {
    const data = await this.fetch<any>(`/cost/account?_=1${this.acct(accountId)}`);
    return { ...transformAccountInfo(data), lastFetchedAt: data.last_fetched_at ?? null };
  }

  async getMonthlyCostTrend(months = 6, accountId?: string): Promise<MonthlyCostEntry[]> {
    const data = await this.fetch<{ data: any[] }>(`/cost/monthly-trend?months=${months}${this.acct(accountId)}`);
    return data.data.map(transformMonthlyCost);
  }

  async getCostByService(start: string, end: string, accountId?: string): Promise<ServiceCostEntry[]> {
    const data = await this.fetch<{ data: any[] }>(`/cost/by-service?start=${start}&end=${end}${this.acct(accountId)}`);
    return data.data.map(transformServiceCost);
  }

  async getCostByTag(tagKey: string, start: string, end: string, accountId?: string): Promise<TagCostEntry[]> {
    const data = await this.fetch<{ data: any[] }>(`/cost/by-tag?tagKey=${tagKey}&start=${start}&end=${end}${this.acct(accountId)}`);
    return data.data.map(transformTagCost);
  }

  async getBudgets(accountId?: string): Promise<Budget[]> {
    const data = await this.fetch<{ budgets: any[] }>(`/budgets?_=1${this.acct(accountId)}`);
    return data.budgets.map(transformBudget);
  }

  async getUnusedResources(region: string, thresholdDays?: number, accountId?: string): Promise<UnusedResourcesData> {
    const params = new URLSearchParams({ region });
    if (thresholdDays) params.set('thresholdDays', String(thresholdDays));
    if (accountId) params.set('account', accountId);
    const data = await this.fetch<any>(`/resources/unused?${params}`);
    return {
      ec2: data.ec2.map(transformUnusedResource),
      ebs: data.ebs.map(transformUnusedResource),
      rds: data.rds.map(transformUnusedResource),
      elb: data.elb.map(transformUnusedResource),
      eip: data.eip.map(transformUnusedResource),
      s3: (data.s3 ?? []).map(transformUnusedResource),
      'vpc-endpoint': (data['vpc-endpoint'] ?? []).map(transformUnusedResource),
      region: data.region,
    };
  }

  async bulkDeleteResources(resources: { type: string; id: string; region: string }[], accountId?: string): Promise<{ deleted: number; failed: number }> {
    const q = accountId ? `?account=${encodeURIComponent(accountId)}` : '';
    return this.fetch(`/resources/bulk-delete${q}`, {
      method: 'POST',
      body: JSON.stringify({ resources }),
    });
  }

  async deleteResource(resourceType: string, resourceId: string, region: string, force = false, accountId?: string): Promise<void> {
    const params = new URLSearchParams({ region });
    if (force) params.set('force', 'true');
    if (accountId) params.set('account', accountId);
    await this.fetch(`/resources/${resourceType}/${encodeURIComponent(resourceId)}?${params}`, {
      method: 'DELETE',
    });
  }

  async getRightsizingRecommendations(accountId?: string): Promise<RightsizingRecommendation[]> {
    const data = await this.fetch<{ recommendations: any[] }>(`/recommendations/rightsizing?_=1${this.acct(accountId)}`);
    return data.recommendations.map(transformRecommendation);
  }

  async getSavingsPlansCoverage(accountId?: string): Promise<CoverageData> {
    const data = await this.fetch<any>(`/recommendations/savings-plans?_=1${this.acct(accountId)}`);
    return transformCoverage(data);
  }

  async getReservedInstanceCoverage(accountId?: string): Promise<CoverageData> {
    const data = await this.fetch<any>(`/recommendations/reserved-instances?_=1${this.acct(accountId)}`);
    return transformCoverage(data);
  }

  async checkDependencies(resourceType: string, resourceId: string, region: string, accountId?: string): Promise<{ blockers: string[]; warnings: string[]; safe: boolean }> {
    const params = new URLSearchParams({ region });
    if (accountId) params.set('account', accountId);
    return this.fetch(`/resources/${resourceType}/${encodeURIComponent(resourceId)}/dependencies?${params}`);
  }

  async invalidateCache(accountId?: string): Promise<void> {
    const q = accountId ? `?account=${encodeURIComponent(accountId)}` : '';
    await this.fetch(`/cost/cache/invalidate${q}`, { method: 'POST' });
  }
}
