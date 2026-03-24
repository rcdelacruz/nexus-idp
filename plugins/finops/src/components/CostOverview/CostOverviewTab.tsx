import React, { useEffect, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { finopsApiRef } from '../../api/FinOpsClient';
import { MonthlyCostEntry, ServiceCostEntry, TagCostEntry, AccountInfo } from '../../api/types';
import {
  Grid, Card, CardContent, Typography, Table, TableBody, TableCell,
  TableHead, TableRow, LinearProgress, CircularProgress, Tabs, Tab, Box,
} from '@material-ui/core';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const lastNMonths = (n: number) => {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - n);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
};

const TAG_KEYS = ['team', 'project', 'env'];

interface CostCache {
  refreshKey: number;
  accountId: string;
  account: AccountInfo | null;
  trend: MonthlyCostEntry[];
  byService: ServiceCostEntry[];
  tagData: Record<string, TagCostEntry[]>;
}
let _costCache: CostCache | null = null;

export const CostOverviewTab = ({ refreshKey, accountId, onFetchedAt }: { refreshKey: number; accountId: string; onFetchedAt?: (ts: string | null) => void }) => {
  const api = useApi(finopsApiRef);
  const cached = (_costCache?.refreshKey === refreshKey && _costCache?.accountId === accountId) ? _costCache : null;
  const [loading, setLoading] = useState(!cached);
  const [account, setAccount] = useState<AccountInfo | null>(cached?.account ?? null);
  const [trend, setTrend] = useState<MonthlyCostEntry[]>(cached?.trend ?? []);
  const [byService, setByService] = useState<ServiceCostEntry[]>(cached?.byService ?? []);
  const [tagTab, setTagTab] = useState(0);
  const [tagData, setTagData] = useState<Record<string, TagCostEntry[]>>(cached?.tagData ?? {});

  useEffect(() => {
    if (_costCache?.refreshKey === refreshKey && _costCache?.accountId === accountId) { setLoading(false); return; }
    let mounted = true;
    const { start, end } = lastNMonths(1);
    setLoading(true);

    Promise.all([
      api.getAccountInfo(accountId),
      api.getMonthlyCostTrend(6, accountId),
      api.getCostByService(start, end, accountId),
      ...TAG_KEYS.map(k => api.getCostByTag(k, start, end, accountId)),
    ]).then(([acc, tr, svc, ...tags]) => {
      if (!mounted) return;
      const tagMap: Record<string, TagCostEntry[]> = {};
      TAG_KEYS.forEach((k, i) => { tagMap[k] = tags[i] as TagCostEntry[]; });
      const newAccount = acc as AccountInfo;
      const newTrend = tr as MonthlyCostEntry[];
      const newByService = (svc as ServiceCostEntry[]).slice(0, 10);
      _costCache = { refreshKey, accountId, account: newAccount, trend: newTrend, byService: newByService, tagData: tagMap };
      setAccount(newAccount);
      setTrend(newTrend);
      setByService(newByService);
      setTagData(tagMap);
      setLoading(false);
      onFetchedAt?.((acc as any).lastFetchedAt ?? null);
    }).catch(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, accountId]);

  if (loading) return <Box display="flex" justifyContent="center" mt={4}><CircularProgress /></Box>;

  const maxCost = Math.max(...trend.map(t => t.totalCost), 1);
  const maxService = Math.max(...byService.map(s => s.cost), 1);

  return (
    <Grid container spacing={3}>
      {/* Account info */}
      {account && (
        <Grid item xs={12}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="textSecondary">AWS Account</Typography>
              <Typography variant="h6">{account.accountId}</Typography>
              <Typography variant="caption" color="textSecondary">{account.arn}</Typography>
            </CardContent>
          </Card>
        </Grid>
      )}

      {/* Monthly trend */}
      <Grid item xs={12}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" gutterBottom><strong>Monthly Cost Trend</strong></Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Month</TableCell>
                  <TableCell>Cost</TableCell>
                  <TableCell style={{ width: '50%' }}></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {trend.map(row => (
                  <TableRow key={row.month}>
                    <TableCell>{row.month}</TableCell>
                    <TableCell>{fmt(row.totalCost)}</TableCell>
                    <TableCell>
                      <LinearProgress
                        variant="determinate"
                        value={(row.totalCost / maxCost) * 100}
                        style={{ height: 8, borderRadius: 4 }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Grid>

      {/* By service */}
      <Grid item xs={12} md={6}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" gutterBottom><strong>Top Services (Last 30 days)</strong></Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Service</TableCell>
                  <TableCell>Cost</TableCell>
                  <TableCell style={{ width: '40%' }}></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {byService.map(row => (
                  <TableRow key={row.service}>
                    <TableCell style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.service}
                    </TableCell>
                    <TableCell>{fmt(row.cost)}</TableCell>
                    <TableCell>
                      <LinearProgress
                        variant="determinate"
                        value={(row.cost / maxService) * 100}
                        style={{ height: 8, borderRadius: 4 }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Grid>

      {/* By tag */}
      <Grid item xs={12} md={6}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" gutterBottom><strong>Cost by Tag (Last 30 days)</strong></Typography>
            <Tabs value={tagTab} onChange={(_e, v) => setTagTab(v)} indicatorColor="primary" textColor="primary">
              {TAG_KEYS.map(k => <Tab key={k} label={k} />)}
            </Tabs>
            {TAG_KEYS.map((k, i) => {
              const rows = tagData[k] ?? [];
              const maxTag = Math.max(...rows.map(r => r.cost), 1);
              return (
                <Box key={k} hidden={tagTab !== i} mt={1}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{k}</TableCell>
                        <TableCell>Cost</TableCell>
                        <TableCell style={{ width: '40%' }}></TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.slice(0, 8).map(row => (
                        <TableRow key={row.tagValue}>
                          <TableCell>{row.tagValue || '(untagged)'}</TableCell>
                          <TableCell>{fmt(row.cost)}</TableCell>
                          <TableCell>
                            <LinearProgress
                              variant="determinate"
                              value={(row.cost / maxTag) * 100}
                              style={{ height: 8, borderRadius: 4 }}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              );
            })}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
};
