import React, { useEffect, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { finopsApiRef } from '../../api/FinOpsClient';
import { RightsizingRecommendation, CoverageData } from '../../api/types';
import {
  Box, Card, CardContent, CircularProgress, Grid,
  LinearProgress, Table, TableBody, TableCell,
  TableHead, TableRow, Typography,
} from '@material-ui/core';

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const CoverageGauge = ({ label, data }: { label: string; data: CoverageData | null }) => {
  if (!data) return null;
  const pct = Math.min(data.coveragePercent, 100);
  const color = pct >= 70 ? '#43a047' : pct >= 40 ? '#fb8c00' : '#e53935';
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle2" gutterBottom><strong>{label}</strong></Typography>
        <Typography variant="h4" style={{ color }}>{pct.toFixed(1)}%</Typography>
        <Typography variant="caption" color="textSecondary">covered</Typography>
        <Box mt={2}>
          <LinearProgress
            variant="determinate"
            value={pct}
            style={{ height: 12, borderRadius: 6, backgroundColor: '#2e2e2e' }}
          />
        </Box>
        <Box mt={1} display="flex" justifyContent="space-between">
          {data.onDemandCost !== undefined && (
            <Typography variant="caption" color="textSecondary">
              On-demand: {fmt(data.onDemandCost)}
            </Typography>
          )}
          {data.spendCoveredBySavingsPlans !== undefined && (
            <Typography variant="caption" color="textSecondary">
              SP covered: {fmt(data.spendCoveredBySavingsPlans)}
            </Typography>
          )}
          {data.onDemandHours !== undefined && (
            <Typography variant="caption" color="textSecondary">
              On-demand hrs: {data.onDemandHours.toFixed(0)}
            </Typography>
          )}
          {data.reservedHours !== undefined && (
            <Typography variant="caption" color="textSecondary">
              Reserved hrs: {data.reservedHours.toFixed(0)}
            </Typography>
          )}
        </Box>
      </CardContent>
    </Card>
  );
};

interface RecsCache {
  refreshKey: number;
  accountId: string;
  rightsizing: RightsizingRecommendation[];
  spCoverage: CoverageData | null;
  riCoverage: CoverageData | null;
}
let _recsCache: RecsCache | null = null;

export const RecommendationsTab = ({ refreshKey, accountId }: { refreshKey: number; accountId: string }) => {
  const api = useApi(finopsApiRef);
  const c = useColors();
  const cached = (_recsCache?.refreshKey === refreshKey && _recsCache?.accountId === accountId) ? _recsCache : null;
  const [loading, setLoading] = useState(!cached);
  const [rightsizing, setRightsizing] = useState<RightsizingRecommendation[]>(cached?.rightsizing ?? []);
  const [spCoverage, setSpCoverage] = useState<CoverageData | null>(cached?.spCoverage ?? null);
  const [riCoverage, setRiCoverage] = useState<CoverageData | null>(cached?.riCoverage ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (_recsCache?.refreshKey === refreshKey && _recsCache?.accountId === accountId) { setLoading(false); return; }
    let mounted = true;
    setLoading(true);
    Promise.all([
      api.getRightsizingRecommendations(accountId),
      api.getSavingsPlansCoverage(accountId),
      api.getReservedInstanceCoverage(accountId),
    ]).then(([rs, sp, ri]) => {
      if (!mounted) return;
      _recsCache = { refreshKey, accountId, rightsizing: rs, spCoverage: sp, riCoverage: ri };
      setRightsizing(rs);
      setSpCoverage(sp);
      setRiCoverage(ri);
      setLoading(false);
    }).catch(err => { if (mounted) { setError(err.message); setLoading(false); } });
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, accountId]);

  if (loading) return <Box display="flex" justifyContent="center" mt={4}><CircularProgress /></Box>;
  if (error) return <Typography color="error">Failed to load recommendations: {error}</Typography>;

  const totalSavings = rightsizing.reduce((s, r) => s + r.estimatedMonthlySavings, 0);

  return (
    <Grid container spacing={3}>
      {/* Coverage gauges */}
      <Grid item xs={12} sm={6}>
        <CoverageGauge label="Savings Plans Coverage" data={spCoverage} />
      </Grid>
      <Grid item xs={12} sm={6}>
        <CoverageGauge label="Reserved Instance Coverage" data={riCoverage} />
      </Grid>

      {/* Rightsizing */}
      <Grid item xs={12}>
        <Card variant="outlined">
          <CardContent>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="subtitle1"><strong>Rightsizing Recommendations</strong></Typography>
              {rightsizing.length > 0 && (
                <Typography variant="body2" color="textSecondary">
                  Potential savings: <strong style={{ color: '#43a047' }}>{fmt(totalSavings)}/mo</strong>
                </Typography>
              )}
            </Box>
            {rightsizing.length === 0 ? (
              <Typography color="textSecondary">No rightsizing recommendations available.</Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Instance ID</TableCell>
                    <TableCell>Region</TableCell>
                    <TableCell>Current Type</TableCell>
                    <TableCell>Recommended</TableCell>
                    <TableCell>Est. Monthly Savings</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rightsizing.map(r => (
                    <TableRow key={r.instanceId}>
                      <TableCell>
                        <a
                          href={`https://${r.region}.console.aws.amazon.com/ec2/v2/home?region=${r.region}#Instances:instanceId=${r.instanceId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${r.instanceId} in AWS Console`}
                          style={{ fontFamily: '"Geist Mono", monospace', color: c.blue, textDecoration: 'none', fontWeight: 500 }}
                        >
                          {r.instanceId}
                        </a>
                      </TableCell>
                      <TableCell>{r.region}</TableCell>
                      <TableCell>{r.currentType}</TableCell>
                      <TableCell>{r.targetType}</TableCell>
                      <TableCell style={{ color: '#43a047' }}>{fmt(r.estimatedMonthlySavings)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
};
