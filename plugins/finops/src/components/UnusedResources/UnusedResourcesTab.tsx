import React, { useState, useCallback, useMemo } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { finopsApiRef } from '../../api/FinOpsClient';
import { UnusedResource, UnusedResourcesData } from '../../api/types';
import { DeleteResourceDialog } from './DeleteResourceDialog';
import {
  Box, Button, CircularProgress, FormControl, InputLabel,
  MenuItem, Select, Table, TableBody, TableCell, TableHead,
  TableRow, Typography, Accordion, AccordionSummary, AccordionDetails,
  Chip, Checkbox, Dialog, DialogTitle, DialogContent, DialogContentText,
  DialogActions,
} from '@material-ui/core';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import DeleteIcon from '@material-ui/icons/Delete';
import DeleteSweepIcon from '@material-ui/icons/DeleteSweep';

const AWS_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2',
  'eu-west-1', 'eu-west-2', 'eu-central-1',
  'sa-east-1', 'ca-central-1',
];

const THRESHOLD_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '60 days', value: 60 },
  { label: '90 days', value: 90 },
  { label: '180 days (6 months)', value: 180 },
  { label: '365 days (1 year)', value: 365 },
];

const SECTION_LABELS: Record<string, string> = {
  ec2: 'EC2 Instances',
  ebs: 'EBS Volumes (Unattached)',
  rds: 'RDS Instances',
  elb: 'Load Balancers',
  eip: 'Elastic IPs',
  s3: 'S3 Buckets (Empty)',
  'vpc-endpoint': 'VPC Endpoints (Unattached)',
};

const getConsoleUrl = (resource: UnusedResource): string => {
  const r = resource.region;
  const id = encodeURIComponent(resource.resourceId);
  switch (resource.resourceType) {
    case 'ec2':
      return `https://${r}.console.aws.amazon.com/ec2/v2/home?region=${r}#Instances:instanceId=${id}`;
    case 'ebs':
      return `https://${r}.console.aws.amazon.com/ec2/v2/home?region=${r}#Volumes:volumeId=${id}`;
    case 'rds':
      return `https://${r}.console.aws.amazon.com/rds/home?region=${r}#database:id=${id};is-cluster=false`;
    case 'elb':
      return `https://${r}.console.aws.amazon.com/ec2/v2/home?region=${r}#LoadBalancers:search=${encodeURIComponent(resource.resourceName ?? '')}`;
    case 'eip':
      return `https://${r}.console.aws.amazon.com/ec2/v2/home?region=${r}#Addresses:AllocationId=${id}`;
    case 's3':
      return `https://s3.console.aws.amazon.com/s3/buckets/${resource.resourceId}?region=${r}`;
    case 'vpc-endpoint':
      return `https://${r}.console.aws.amazon.com/vpc/home?region=${r}#Endpoints:vpcEndpointId=${id}`;
    default:
      return '#';
  }
};

const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

const SafetyBadge = ({ resource }: { resource: UnusedResource }) => {
  let label = 'Safe to delete';
  let color = '#2e7d32'; // green

  if (resource.resourceType === 'ec2') {
    if (resource.state === 'running') {
      if ((resource.maxCpuPercent ?? 0) > 1) { label = 'Review — has CPU activity'; color = '#e65100'; }
      else { label = 'Running but idle'; color = '#f57c00'; }
    } else {
      label = 'Stopped — safe'; color = '#2e7d32';
    }
  } else if (resource.resourceType === 'rds') {
    if ((resource.maxConnections ?? 0) > 0) { label = 'Had connections — review'; color = '#e65100'; }
    else { label = 'No connections — safe'; color = '#2e7d32'; }
  } else if (resource.resourceType === 'elb') {
    if ((resource.totalRequests ?? 0) > 0) { label = 'Had traffic — review'; color = '#e65100'; }
    else { label = 'No traffic — safe'; color = '#2e7d32'; }
  } else if (resource.resourceType === 's3') {
    label = 'Empty — check before deleting'; color = '#f57c00';
  }

  return <span style={{ fontSize: 11, fontWeight: 600, color, whiteSpace: 'nowrap' }}>● {label}</span>;
};

const MetricDetail = ({ resource }: { resource: UnusedResource }) => {
  const parts: string[] = [];
  if (resource.resourceType === 'ec2') {
    if (resource.avgCpuPercent !== undefined) parts.push(`Avg CPU: ${resource.avgCpuPercent}%`);
    if (resource.maxCpuPercent !== undefined) parts.push(`Max CPU: ${resource.maxCpuPercent}%`);
  }
  if (resource.resourceType === 'rds') {
    if (resource.maxConnections !== undefined) parts.push(`Max connections: ${resource.maxConnections}`);
  }
  if (resource.resourceType === 'elb') {
    if (resource.totalRequests !== undefined) parts.push(`Total requests: ${resource.totalRequests.toLocaleString()}`);
  }
  if (!parts.length) return null;
  return <Typography variant="caption" color="textSecondary" style={{ display: 'block' }}>{parts.join(' · ')}</Typography>;
};

const TagsDetail = ({ tags }: { tags: Record<string, string> }) => {
  const relevant = ['Owner', 'owner', 'Environment', 'env', 'Team', 'team', 'Project', 'project']
    .map(k => ({ k, v: tags[k] }))
    .filter(e => e.v);
  if (!relevant.length) return <Typography variant="caption" color="textSecondary">No tags</Typography>;
  return (
    <Box display="flex" style={{ gap: 4, flexWrap: 'wrap' }}>
      {relevant.map(({ k, v }) => (
        <Chip key={k} size="small" label={`${k}: ${v}`} style={{ fontSize: 10, height: 18 }} />
      ))}
    </Box>
  );
};

interface ResourceTableProps {
  rows: UnusedResource[];
  type: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: (ids: string[], checked: boolean) => void;
  onDelete: (r: UnusedResource) => void;
  busy: boolean;
  mixed?: boolean;
}

const ResourceTable = ({ rows, type, selected, onToggle, onSelectAll, onDelete, busy, mixed }: ResourceTableProps) => {
  if (rows.length === 0) return <Typography color="textSecondary" style={{ padding: 16 }}>No idle {type} resources found.</Typography>;

  const allSelected = rows.every(r => selected.has(r.resourceId));
  const someSelected = rows.some(r => selected.has(r.resourceId));

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell padding="checkbox">
            <Checkbox
              indeterminate={someSelected && !allSelected}
              checked={allSelected}
              disabled={busy}
              onChange={e => onSelectAll(rows.map(r => r.resourceId), e.target.checked)}
            />
          </TableCell>
          {mixed && <TableCell>Type</TableCell>}
          <TableCell>ID / Name</TableCell>
          <TableCell>Tags</TableCell>
          {!mixed && (type === 'ec2' || type === 'rds' || type === 'elb') && <TableCell>Type / Engine</TableCell>}
          {!mixed && type === 'ebs' && <TableCell>Size / Type</TableCell>}
          <TableCell>State</TableCell>
          {!mixed && <TableCell>Metrics</TableCell>}
          <TableCell>Created</TableCell>
          <TableCell>Safety</TableCell>
          <TableCell align="right">Actions</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map(r => (
          <TableRow key={r.resourceId} selected={selected.has(r.resourceId)}>
            <TableCell padding="checkbox">
              <Checkbox checked={selected.has(r.resourceId)} disabled={busy} onChange={() => onToggle(r.resourceId)} />
            </TableCell>
            {mixed && (
              <TableCell>
                <Chip size="small" label={r.resourceType.toUpperCase()} style={{ fontSize: 10, height: 20 }} />
              </TableCell>
            )}
            <TableCell>
              <Typography variant="body2" style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.resourceId}</Typography>
              {r.resourceName && r.resourceName !== r.resourceId && (
                <Typography variant="caption" color="textSecondary">{r.resourceName}</Typography>
              )}
            </TableCell>
            <TableCell><TagsDetail tags={r.tags} /></TableCell>
            {!mixed && (type === 'ec2' || type === 'rds' || type === 'elb') && (
              <TableCell>
                <Typography variant="body2">{r.instanceType ?? '—'}</Typography>
                {r.engine && <Typography variant="caption" color="textSecondary">{r.engine}</Typography>}
              </TableCell>
            )}
            {!mixed && type === 'ebs' && (
              <TableCell>
                <Typography variant="body2">{r.sizeGb ? `${r.sizeGb} GB` : '—'}</Typography>
                {r.volumeType && <Typography variant="caption" color="textSecondary">{r.volumeType}</Typography>}
              </TableCell>
            )}
            <TableCell>
              <Chip size="small" label={r.state ?? '—'} style={{ fontSize: 10, height: 20 }} />
            </TableCell>
            {!mixed && <TableCell><MetricDetail resource={r} /></TableCell>}
            <TableCell style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.launchTime)}</TableCell>
            <TableCell><SafetyBadge resource={r} /></TableCell>
            <TableCell align="right">
              <Box display="flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
                <Button
                  size="small"
                  variant="outlined"
                  href={getConsoleUrl(r)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 11 }}
                >
                  AWS ↗
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DeleteIcon />}
                  onClick={() => onDelete(r)}
                  disabled={busy}
                  style={busy ? {} : { color: '#e53935', borderColor: '#e53935' }}
                >
                  Delete
                </Button>
              </Box>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export const UnusedResourcesTab = ({ accountId }: { accountId: string }) => {
  const api = useApi(finopsApiRef);
  const [region, setRegion] = useState('us-east-1');
  const [thresholdDays, setThresholdDays] = useState(180);
  const [data, setData] = useState<UnusedResourcesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<UnusedResource | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [groupByTag, setGroupByTag] = useState('');

  const busy = loading || deleting || bulkDeleting;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    api.getUnusedResources(region, thresholdDays, accountId)
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [api, region, thresholdDays, accountId]);

  const handleToggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSelectAll = (ids: string[], checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      ids.forEach(id => checked ? next.add(id) : next.delete(id));
      return next;
    });
  };

  const handleDelete = async (force = false) => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.deleteResource(toDelete.resourceType, toDelete.resourceId, toDelete.region, force, accountId);
      setToDelete(null);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleBulkDelete = async () => {
    if (!data) return;
    setBulkDeleting(true);
    const allResources = [...data.ec2, ...data.ebs, ...data.rds, ...data.elb, ...data.eip];
    const toDeleteBulk = allResources
      .filter(r => selected.has(r.resourceId))
      .map(r => ({ type: r.resourceType, id: r.resourceId, region: r.region }));

    try {
      const result = await api.bulkDeleteResources(toDeleteBulk, accountId);
      setBulkConfirmOpen(false);
      if (result.failed > 0) {
        setError(`Deleted ${result.deleted}, failed ${result.failed}. Check logs for details.`);
      }
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  const allResources = data ? [...data.ec2, ...data.ebs, ...data.rds, ...data.elb, ...data.eip, ...data.s3, ...data['vpc-endpoint']] : [];
  const totalUnused = allResources.length;
  const selectedCount = selected.size;

  const availableTagKeys = useMemo(() => {
    const keys = new Set<string>();
    allResources.forEach(r => Object.keys(r.tags).forEach(k => keys.add(k)));
    return Array.from(keys).sort();
  }, [allResources]);

  const tagGroups = useMemo(() => {
    if (!groupByTag || !data) return null;
    const groups = new Map<string, UnusedResource[]>();
    allResources.forEach(r => {
      const val = r.tags[groupByTag] ?? '(untagged)';
      if (!groups.has(val)) groups.set(val, []);
      groups.get(val)!.push(r);
    });
    return Array.from(groups.entries()).sort(([a], [b]) =>
      a === '(untagged)' ? 1 : b === '(untagged)' ? -1 : a.localeCompare(b),
    );
  }, [allResources, groupByTag, data]);

  return (
    <Box>
      <Box display="flex" alignItems="center" mb={3} style={{ gap: 12, flexWrap: 'wrap' }}>
        <FormControl variant="outlined" size="small" style={{ minWidth: 180 }}>
          <InputLabel>Region</InputLabel>
          <Select value={region} onChange={e => setRegion(e.target.value as string)} label="Region">
            {AWS_REGIONS.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
          </Select>
        </FormControl>

        <FormControl variant="outlined" size="small" style={{ minWidth: 200 }}>
          <InputLabel>Idle Threshold</InputLabel>
          <Select value={thresholdDays} onChange={e => setThresholdDays(e.target.value as number)} label="Idle Threshold">
            {THRESHOLD_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </Select>
        </FormControl>

        <Button variant="contained" color="primary" onClick={load} disabled={busy}>
          {loading ? 'Scanning...' : 'Scan'}
        </Button>

        {data && availableTagKeys.length > 0 && (
          <FormControl variant="outlined" size="small" style={{ minWidth: 180 }}>
            <InputLabel>Group by tag</InputLabel>
            <Select value={groupByTag} onChange={e => setGroupByTag(e.target.value as string)} label="Group by tag">
              <MenuItem value=""><em>None (by type)</em></MenuItem>
              {availableTagKeys.map(k => <MenuItem key={k} value={k}>{k}</MenuItem>)}
            </Select>
          </FormControl>
        )}

        {data && <Chip label={`${totalUnused} unused resource${totalUnused !== 1 ? 's' : ''}`} />}

        {selectedCount > 0 && (
          <Button
            variant="contained"
            startIcon={bulkDeleting ? <CircularProgress size={16} color="inherit" /> : <DeleteSweepIcon />}
            onClick={() => setBulkConfirmOpen(true)}
            disabled={busy}
            style={{ background: '#e53935', color: '#fff', marginLeft: 'auto' }}
          >
            Delete Selected ({selectedCount})
          </Button>
        )}
      </Box>

      {error && <Typography color="error" style={{ marginBottom: 16 }}>Error: {error}</Typography>}
      {loading && <Box display="flex" justifyContent="center" mt={4}><CircularProgress /></Box>}

      {!loading && data && tagGroups && tagGroups.map(([tagValue, rows]) => (
        <Accordion key={tagValue} defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box display="flex" alignItems="center" style={{ gap: 12 }}>
              <Typography><strong>{groupByTag}: {tagValue}</strong></Typography>
              <Chip size="small" label={rows.length} />
              {rows.some(r => selected.has(r.resourceId)) && (
                <Chip size="small" label={`${rows.filter(r => selected.has(r.resourceId)).length} selected`} color="secondary" />
              )}
            </Box>
          </AccordionSummary>
          <AccordionDetails style={{ padding: 0 }}>
            <ResourceTable
              rows={rows}
              type="mixed"
              selected={selected}
              onToggle={handleToggle}
              onSelectAll={handleSelectAll}
              onDelete={setToDelete}
              busy={busy}
              mixed
            />
          </AccordionDetails>
        </Accordion>
      ))}

      {!loading && data && !tagGroups && (['ec2', 'ebs', 'rds', 'elb', 'eip', 's3', 'vpc-endpoint'] as const).map(type => (
        <Accordion key={type} defaultExpanded={data[type].length > 0}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box display="flex" alignItems="center" style={{ gap: 12 }}>
              <Typography><strong>{SECTION_LABELS[type]}</strong></Typography>
              <Chip size="small" label={data[type].length} />
              {data[type].some(r => selected.has(r.resourceId)) && (
                <Chip size="small" label={`${data[type].filter(r => selected.has(r.resourceId)).length} selected`} color="secondary" />
              )}
            </Box>
          </AccordionSummary>
          <AccordionDetails style={{ padding: 0 }}>
            <ResourceTable
              rows={data[type]}
              type={type}
              selected={selected}
              onToggle={handleToggle}
              onSelectAll={handleSelectAll}
              onDelete={setToDelete}
              busy={busy}
            />
          </AccordionDetails>
        </Accordion>
      ))}

      <DeleteResourceDialog
        resource={toDelete}
        onConfirm={handleDelete}
        onCancel={() => setToDelete(null)}
        deleting={deleting}
      />

      <Dialog open={bulkConfirmOpen} onClose={() => setBulkConfirmOpen(false)}>
        <DialogTitle>Delete {selectedCount} resources?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            You are about to permanently delete <strong>{selectedCount} resource{selectedCount !== 1 ? 's' : ''}</strong> that have been idle for more than <strong>{thresholdDays} days</strong>. This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkConfirmOpen(false)} disabled={bulkDeleting}>Cancel</Button>
          <Button
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
            style={{ color: '#e53935' }}
          >
            {bulkDeleting ? <CircularProgress size={16} /> : `Delete ${selectedCount} resources`}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
