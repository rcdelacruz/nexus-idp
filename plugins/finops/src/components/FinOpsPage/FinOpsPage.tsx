import React, { useEffect, useState } from 'react';
import { Page, Header, Content } from '@backstage/core-components';
import { Tab, Tabs, Box, IconButton, Tooltip, CircularProgress, Select, MenuItem, FormControl } from '@material-ui/core';
import { RefreshOutlined } from '@material-ui/icons';
import { useApi } from '@backstage/core-plugin-api';
import { finopsApiRef } from '../../api/FinOpsClient';
import { AwsAccount } from '../../api/types';
import { CostOverviewTab } from '../CostOverview/CostOverviewTab';
import { BudgetTrackingTab } from '../BudgetTracking/BudgetTrackingTab';
import { UnusedResourcesTab } from '../UnusedResources/UnusedResourcesTab';
import { RecommendationsTab } from '../Recommendations/RecommendationsTab';

const SK_ACCOUNT = 'finops_accountId';
const SK_TAB = 'finops_tab';
const skRefresh = (id: string) => `finops_refreshKey_${id}`;
const skFetchedAt = (id: string) => `finops_fetchedAt_${id}`;

const getStoredRefreshKey = (id: string): number => {
  try { return parseInt(sessionStorage.getItem(skRefresh(id)) ?? '0', 10); } catch { return 0; }
};
const setStoredRefreshKey = (id: string, key: number) => {
  try { sessionStorage.setItem(skRefresh(id), String(key)); } catch {}
};
const getStoredAccount = (): string => {
  try { return sessionStorage.getItem(SK_ACCOUNT) ?? ''; } catch { return ''; }
};
const getStoredFetchedAt = (id: string): string | null => {
  try { return sessionStorage.getItem(skFetchedAt(id)); } catch { return null; }
};
const setStoredFetchedAt = (id: string, ts: string | null) => {
  try {
    if (ts) sessionStorage.setItem(skFetchedAt(id), ts);
    else sessionStorage.removeItem(skFetchedAt(id));
  } catch {}
};

export const FinOpsPage = () => {
  const [tab, setTab] = useState<number>(() => {
    try { return parseInt(sessionStorage.getItem(SK_TAB) ?? '0', 10); } catch { return 0; }
  });
  const [accountId, setAccountId] = useState<string>(getStoredAccount);
  const [refreshKey, setRefreshKey] = useState<number>(() => {
    const id = getStoredAccount();
    return id ? getStoredRefreshKey(id) : 0;
  });
  const [refreshing, setRefreshing] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<string | null>(() => {
    const id = getStoredAccount();
    return id ? getStoredFetchedAt(id) : null;
  });
  const [accounts, setAccounts] = useState<AwsAccount[]>([]);
  const finopsApi = useApi(finopsApiRef);

  useEffect(() => {
    finopsApi.getAccounts().then(list => {
      setAccounts(list);
      if (list.length > 0) {
        const stored = getStoredAccount();
        const valid = list.find(a => a.id === stored);
        const chosen = valid ? stored : list[0].id;
        setAccountId(chosen);
        setRefreshKey(getStoredRefreshKey(chosen));
        setFetchedAt(getStoredFetchedAt(chosen));
        try { sessionStorage.setItem(SK_ACCOUNT, chosen); } catch {}
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFetchedAt = (ts: string | null) => {
    if (!ts || fetchedAt) return;
    setStoredFetchedAt(accountId, ts);
    setFetchedAt(ts);
  };

  const handleAccountChange = (newId: string) => {
    setAccountId(newId);
    try { sessionStorage.setItem(SK_ACCOUNT, newId); } catch {}
    setFetchedAt(getStoredFetchedAt(newId));
    setRefreshKey(getStoredRefreshKey(newId));
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await finopsApi.invalidateCache(accountId); } catch (e: any) { console.error('invalidateCache failed:', e?.message ?? e); }
    const now = new Date().toISOString();
    const newKey = getStoredRefreshKey(accountId) + 1;
    setStoredRefreshKey(accountId, newKey);
    setStoredFetchedAt(accountId, now);
    setRefreshKey(newKey);
    setFetchedAt(now);
    setRefreshing(false);
  };

  const selectedAccount = accounts.find(a => a.id === accountId);
  const accountLabel = selectedAccount ? `${selectedAccount.name} · ` : '';
  const awsTimestamp = fetchedAt
    ? `${accountLabel}data as of: ${new Date(fetchedAt).toLocaleString()}`
    : `${accountLabel}data as of: unknown — click ↺ to sync`;

  return (
    <Page themeId="tool">
      <Header
        title="FinOps Dashboard"
        subtitle={`AWS cost visibility and resource optimization · ${awsTimestamp}`}
      >
        {accounts.length > 1 && (
          <FormControl variant="outlined" size="small" style={{ marginRight: 8, minWidth: 140 }}>
            <Select
              value={accountId}
              onChange={e => handleAccountChange(e.target.value as string)}
              style={{ color: '#fff', borderColor: 'rgba(255,255,255,0.3)', fontSize: '0.875rem' }}
            >
              {accounts.map(a => (
                <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        {accounts.length === 1 && selectedAccount && (
          <span style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.7)', marginRight: 12 }}>
            {selectedAccount.name}
          </span>
        )}
        <Tooltip title="Refresh data (clears cache)">
          <span>
            <IconButton onClick={handleRefresh} disabled={refreshing} color="inherit">
              {refreshing ? <CircularProgress size={20} color="inherit" /> : <RefreshOutlined />}
            </IconButton>
          </span>
        </Tooltip>
      </Header>
      <Content>
        <Tabs
          value={tab}
          onChange={(_e, v) => { setTab(v); try { sessionStorage.setItem(SK_TAB, String(v)); } catch {} }}
          indicatorColor="primary"
          textColor="primary"
          style={{ marginBottom: 24, borderBottom: '1px solid #2e2e2e' }}
        >
          <Tab label="Cost Overview" />
          <Tab label="Budgets" />
          <Tab label="Unused Resources" />
          <Tab label="Recommendations" />
        </Tabs>

        <Box hidden={tab !== 0}><CostOverviewTab refreshKey={refreshKey} accountId={accountId} onFetchedAt={handleFetchedAt} /></Box>
        <Box hidden={tab !== 1}><BudgetTrackingTab refreshKey={refreshKey} accountId={accountId} /></Box>
        <Box hidden={tab !== 2}><UnusedResourcesTab accountId={accountId} /></Box>
        <Box hidden={tab !== 3}><RecommendationsTab refreshKey={refreshKey} accountId={accountId} /></Box>
      </Content>
    </Page>
  );
};
