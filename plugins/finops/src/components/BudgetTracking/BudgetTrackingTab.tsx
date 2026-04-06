import React, { useEffect, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { finopsApiRef } from '../../api/FinOpsClient';
import { Budget } from '../../api/types';
import {
  Grid, Card, CardContent, Typography, LinearProgress,
  CircularProgress, Box, Chip,
} from '@material-ui/core';
import { useColors, semantic } from '@stratpoint/theme-utils';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

interface BudgetCache { refreshKey: number; accountId: string; budgets: Budget[]; }
let _budgetCache: BudgetCache | null = null;

export const BudgetTrackingTab = ({ refreshKey, accountId }: { refreshKey: number; accountId: string }) => {
  const api = useApi(finopsApiRef);
  const c = useColors();
  const cached = (_budgetCache?.refreshKey === refreshKey && _budgetCache?.accountId === accountId) ? _budgetCache : null;
  const [budgets, setBudgets] = useState<Budget[]>(cached?.budgets ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (_budgetCache?.refreshKey === refreshKey && _budgetCache?.accountId === accountId) { setLoading(false); return undefined; }
    let mounted = true;
    setLoading(true);
    api.getBudgets(accountId)
      .then(data => {
        if (!mounted) return;
        _budgetCache = { refreshKey, accountId, budgets: data };
        setBudgets(data);
        setLoading(false);
      })
      .catch(err => { if (mounted) { setError(err.message); setLoading(false); } });
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, accountId]);

  if (loading) return <Box display="flex" justifyContent="center" mt={4}><CircularProgress /></Box>;
  if (error) return <Typography color="error">Failed to load budgets: {error}</Typography>;
  if (budgets.length === 0) return <Typography color="textSecondary">No budgets configured.</Typography>;

  return (
    <Grid container spacing={3}>
      {budgets.map(b => {
        const pct = Math.min(b.usagePercent, 100);
        let color: string;
        if (b.usagePercent >= 90) { color = semantic.error; }
        else if (b.usagePercent >= 75) { color = semantic.warning; }
        else { color = semantic.success; }
        return (
          <Grid item xs={12} sm={6} md={4} key={b.name}>
            <Card variant="outlined">
              <CardContent>
                <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={1}>
                  <Typography variant="subtitle2"><strong>{b.name}</strong></Typography>
                  <Chip label={b.budgetType} size="small" />
                </Box>
                <Typography variant="h5" style={{ color }}>
                  {fmt(b.actualSpend)}
                </Typography>
                <Typography variant="caption" color="textSecondary">
                  of {fmt(b.limitAmount)} {b.limitUnit} limit
                </Typography>
                <Box mt={1} mb={0.5}>
                  <LinearProgress
                    variant="determinate"
                    value={pct}
                    style={{ height: 10, borderRadius: 5, backgroundColor: c.progressTrack }}
                  />
                </Box>
                <Box display="flex" justifyContent="space-between">
                  <Typography variant="caption" color="textSecondary">
                    {b.usagePercent.toFixed(1)}% used
                  </Typography>
                  {b.forecastedSpend !== undefined && (
                    <Typography variant="caption" color="textSecondary">
                      Forecast: {fmt(b.forecastedSpend)}
                    </Typography>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        );
      })}
    </Grid>
  );
};
