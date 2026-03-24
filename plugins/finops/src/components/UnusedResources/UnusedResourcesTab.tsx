import React, { useState, useCallback, useMemo } from 'react';
import { useApi, configApiRef } from '@backstage/core-plugin-api';
import { finopsApiRef } from '../../api/FinOpsClient';
import { UnusedResource, UnusedResourcesData } from '../../api/types';
import { DeleteResourceDialog } from './DeleteResourceDialog';
import { EditTagsDialog } from './EditTagsDialog';
import {
  Box, Button, CircularProgress, FormControl, InputLabel,
  MenuItem, Select, Table, TableBody, TableCell, TableHead,
  TableRow, TableSortLabel, Typography, Accordion, AccordionSummary, AccordionDetails,
  Chip, Checkbox, Dialog, DialogTitle, DialogContent, DialogContentText,
  DialogActions, ListSubheader,
} from '@material-ui/core';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import DeleteIcon from '@material-ui/icons/Delete';
import DeleteSweepIcon from '@material-ui/icons/DeleteSweep';


const ALL_AWS_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
  'ap-south-1', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1',
  'sa-east-1', 'ca-central-1',
];

const THRESHOLD_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '60 days', value: 60 },
  { label: '90 days', value: 90 },
  { label: '180 days (6 months)', value: 180 },
  { label: '365 days (1 year)', value: 365 },
  { label: 'Beyond 1 year', value: 730 },
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

const getConsoleUrl = (
  resource: UnusedResource,
  awsAccountNumber?: string,
  accessPortalUrl?: string,
  roleName?: string,
): string => {
  const r = resource.region;
  const id = encodeURIComponent(resource.resourceId);
  let destination = '';
  switch (resource.resourceType) {
    case 'ec2':
      destination = `https://${r}.console.aws.amazon.com/ec2/v2/home?region=${r}#Instances:instanceId=${id}`; break;
    case 'ebs':
      destination = `https://${r}.console.aws.amazon.com/ec2/v2/home?region=${r}#Volumes:volumeId=${id}`; break;
    case 'rds':
      destination = `https://${r}.console.aws.amazon.com/rds/home?region=${r}#database:id=${id};is-cluster=false`; break;
    case 'elb':
      destination = `https://${r}.console.aws.amazon.com/ec2/v2/home?region=${r}#LoadBalancers:search=${encodeURIComponent(resource.resourceName ?? '')}`; break;
    case 'eip':
      destination = `https://${r}.console.aws.amazon.com/ec2/v2/home?region=${r}#Addresses:AllocationId=${id}`; break;
    case 's3':
      destination = `https://s3.console.aws.amazon.com/s3/buckets/${resource.resourceId}?region=${r}`; break;
    case 'vpc-endpoint':
      destination = `https://${r}.console.aws.amazon.com/vpc/home?region=${r}#Endpoints:vpcEndpointId=${id}`; break;
    default:
      return '#';
  }
  if (accessPortalUrl && awsAccountNumber) {
    return `${accessPortalUrl}/#/console?account_id=${awsAccountNumber}&role_name=${roleName ?? 'AdministratorAccess'}&destination=${encodeURIComponent(destination)}`;
  }
  return destination;
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
    if (resource.state === 'empty') { label = 'Empty — safe to delete'; color = '#2e7d32'; }
    else if (resource.state === 'has-objects') { label = 'Has objects — review first'; color = '#e65100'; }
    else { label = 'Review before deleting'; color = '#f57c00'; }
  }

  return <span style={{ fontSize: 11, fontWeight: 600, color, whiteSpace: 'nowrap' }}>● {label}</span>;
};


const REQUIRED_TAGS = ['team', 'owner', 'environment', 'project'];

const getMissingTags = (tags: Record<string, string>) =>
  REQUIRED_TAGS.filter(k => !Object.keys(tags).some(t => t.toLowerCase() === k));

const SHOW_TAG_KEYS = ['team', 'owner', 'environment', 'project', 'name'];

const TagsDetail = ({ tags }: { tags: Record<string, string> }) => {
  const relevant = Object.entries(tags)
    .filter(([k]) => SHOW_TAG_KEYS.includes(k.toLowerCase()))
    .map(([k, v]) => ({ k, v }));
  const missing = getMissingTags(tags);
  return (
    <Box display="flex" style={{ gap: 3, flexWrap: 'wrap', maxWidth: 160 }}>
      {relevant.map(({ k, v }) => (
        <Chip key={k} size="small" title={`${k}: ${v}`} label={v} style={{ fontSize: 10, height: 16, maxWidth: 120 }} />
      ))}
      {missing.map(k => (
        <Chip key={k} size="small" label={`!${k}`} style={{ fontSize: 10, height: 16, background: '#ffebee', color: '#c62828' }} />
      ))}
    </Box>
  );
};

interface ResourceTableProps {
  rows: UnusedResource[];
  type: string;
  accountId: string;
  awsAccountNumber?: string;
  accessPortalUrl?: string;
  roleName?: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: (ids: string[], checked: boolean) => void;
  onDelete: (r: UnusedResource) => void;
  onEditTags: (r: UnusedResource) => void;
  busy: boolean;
  mixed?: boolean;
}

type SortKey = 'resourceId' | 'region' | 'state' | 'launchTime' | 'idleDays';

const ResourceTable = ({ rows, type, awsAccountNumber, accessPortalUrl, roleName, selected, onToggle, onSelectAll, onDelete, onEditTags, busy, mixed }: ResourceTableProps) => {
  const [sortBy, setSortBy] = useState<SortKey>('idleDays');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  if (rows.length === 0) return <Typography color="textSecondary" style={{ padding: 16 }}>No idle {type} resources found.</Typography>;

  const handleSort = (col: SortKey) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('asc'); }
  };

  const sorted = [...rows].sort((a, b) => {
    let av: any = a[sortBy];
    let bv: any = b[sortBy];
    if (sortBy === 'launchTime') { av = av ? new Date(av).getTime() : 0; bv = bv ? new Date(bv).getTime() : 0; }
    if (sortBy === 'idleDays') { av = av ?? -1; bv = bv ?? -1; }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const col = (key: SortKey, label: string) => (
    <TableCell sortDirection={sortBy === key ? sortDir : false}>
      <TableSortLabel active={sortBy === key} direction={sortBy === key ? sortDir : 'asc'} onClick={() => handleSort(key)}>
        {label}
      </TableSortLabel>
    </TableCell>
  );

  const allSelected = rows.every(r => selected.has(r.resourceId));
  const someSelected = rows.some(r => selected.has(r.resourceId));

  return (
    <Box style={{ overflowX: 'auto', width: '100%' }}>
    <Table size="small" style={{ minWidth: 900 }}>
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
          {col('resourceId', 'ID / Name')}
          {col('region', 'Region')}
          <TableCell>Tags</TableCell>
          {!mixed && (type === 'ec2' || type === 'rds' || type === 'elb') && <TableCell>Type / Engine</TableCell>}
          {!mixed && type === 'ebs' && <TableCell>Size / Type</TableCell>}
          {col('state', 'State')}
          {col('launchTime', 'Created')}
          {col('idleDays', 'Age (days)')}
          <TableCell>Safety</TableCell>
          <TableCell align="right" style={{ whiteSpace: 'nowrap' }}>Actions</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {sorted.map(r => (
          <TableRow key={r.resourceId} selected={selected.has(r.resourceId)}>
            <TableCell padding="checkbox">
              <Checkbox checked={selected.has(r.resourceId)} disabled={busy} onChange={() => onToggle(r.resourceId)} />
            </TableCell>
            {mixed && (
              <TableCell>
                <Chip size="small" label={r.resourceType.toUpperCase()} style={{ fontSize: 10, height: 20 }} />
              </TableCell>
            )}
            <TableCell style={{ maxWidth: 260, wordBreak: 'break-all' }}>
              <Typography style={{ fontFamily: 'monospace', fontSize: 14 }}>{r.resourceId}</Typography>
              {r.resourceName && r.resourceName !== r.resourceId && (
                <Typography variant="body2" color="textSecondary">{r.resourceName}</Typography>
              )}
              {(r.isWebsite || (r.cdnDistributionIds && r.cdnDistributionIds.length > 0)) && (
                <Box display="flex" style={{ gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                  {r.isWebsite && (
                    <Chip size="small" label="Website" style={{ fontSize: 10, height: 18, background: '#e3f2fd', color: '#1565c0' }} />
                  )}
                  {r.cdnDistributionIds && r.cdnDistributionIds.length > 0 && (
                    <Chip size="small" label={`CDN ×${r.cdnDistributionIds.length}`} style={{ fontSize: 10, height: 18, background: '#f3e5f5', color: '#6a1b9a' }} />
                  )}
                </Box>
              )}
            </TableCell>
            <TableCell>
              <Typography variant="body2" style={{ fontFamily: 'monospace' }}>{r.region}</Typography>
            </TableCell>
            <TableCell style={{ maxWidth: 170 }}><TagsDetail tags={r.tags} /></TableCell>
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
              <Chip size="small" label={r.state ?? '—'} style={{ fontSize: 11, height: 22 }} />
            </TableCell>
            <TableCell style={{ whiteSpace: 'nowrap' }}>
              <Typography variant="body2">{fmtDate(r.launchTime)}</Typography>
            </TableCell>
            <TableCell>
              {r.idleDays !== undefined
                ? <Typography variant="body2" style={{ fontWeight: r.idleDays > 365 ? 700 : 400, color: r.idleDays > 365 ? '#e53935' : 'inherit' }}>{r.idleDays.toLocaleString()}</Typography>
                : '—'}
            </TableCell>
            <TableCell><SafetyBadge resource={r} /></TableCell>
            <TableCell align="right" style={{ whiteSpace: 'nowrap' }}>
              <Box display="flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
                <Button
                  size="small"
                  variant="outlined"
                  href={getConsoleUrl(r, awsAccountNumber, accessPortalUrl, roleName)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 11 }}
                >
                  AWS ↗
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => onEditTags(r)}
                  disabled={busy}
                  style={{ fontSize: 11 }}
                >
                  Tags
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
    </Box>
  );
};

interface UnusedCache {
  accountId: string;
  region: string;
  thresholdDays: number;
  data: UnusedResourcesData;
}
let _unusedCache: UnusedCache | null = null;

export const UnusedResourcesTab = ({ accountId }: { accountId: string }) => {
  const api = useApi(finopsApiRef);
  const config = useApi(configApiRef);
  const accessPortalUrl = config.getOptionalString('finops.awsAccessPortalUrl');
  const roleName = config.getOptionalString('finops.awsRoleToAssume');
  const awsAccountNumber = (config.getOptionalConfigArray('finops.aws.accounts') ?? [])
    .find(a => a.getString('id') === accountId)
    ?.getOptionalString('awsAccountNumber');
  const [region, setRegion] = useState('all');
  const [thresholdDays, setThresholdDays] = useState(365);
  const [activeRegions, setActiveRegions] = useState<string[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(false);

  React.useEffect(() => {
    setActiveRegions([]);
    setRegion('all');
    setRegionsLoading(true);
    api.getActiveRegions(accountId)
      .then(r => { setActiveRegions(r); setRegionsLoading(false); })
      .catch(() => { setActiveRegions([]); setRegionsLoading(false); });
  }, [api, accountId]);
  const [data, setData] = useState<UnusedResourcesData | null>(null);

  // Restore last scan from module-level cache when accountId stabilizes (survives theme switch remounts)
  React.useEffect(() => {
    if (data || !accountId) return;
    const c = _unusedCache;
    if (c && c.accountId === accountId) {
      setRegion(c.region);
      setThresholdDays(c.thresholdDays);
      setData(c.data);
    }
  }, [accountId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<UnusedResource | null>(null);
  const [toEditTags, setToEditTags] = useState<UnusedResource | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [groupByTag, setGroupByTag] = useState('');
  const [showUntagged, setShowUntagged] = useState(false);

  const busy = loading || deleting || bulkDeleting;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    api.getUnusedResources(region === 'all' ? undefined : region, thresholdDays, accountId)
      .then(d => { _unusedCache = { accountId, region, thresholdDays, data: d }; setData(d); setLoading(false); })
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

  const handleTagsSaved = (updatedTags: Record<string, string>) => {
    if (!toEditTags || !data) return;
    const patch = (list: UnusedResource[]) =>
      list.map(r => r.resourceId === toEditTags.resourceId ? { ...r, tags: updatedTags } : r);
    setData({
      ...data,
      ec2: patch(data.ec2), ebs: patch(data.ebs), rds: patch(data.rds),
      elb: patch(data.elb), eip: patch(data.eip), s3: patch(data.s3),
      'vpc-endpoint': patch(data['vpc-endpoint']),
    });
    setToEditTags(null);
  };

  const handleDelete = async (force = false) => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.deleteResource(toDelete.resourceType, toDelete.resourceId, toDelete.region, force, accountId);
      _unusedCache = null;
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
  const untaggedCount = allResources.filter(r => getMissingTags(r.tags).length > 0).length;
  const selectedCount = selected.size;

  const availableTagKeys = useMemo(() => {
    const keys = new Set<string>();
    allResources.forEach(r => Object.keys(r.tags).forEach(k => keys.add(k)));
    return Array.from(keys).sort();
  }, [allResources]);

  const filteredResources = useMemo(() =>
    showUntagged ? allResources.filter(r => getMissingTags(r.tags).length > 0) : allResources,
  [allResources, showUntagged]);

  const tagGroups = useMemo(() => {
    if (!groupByTag || !data) return null;
    const groups = new Map<string, UnusedResource[]>();
    filteredResources.forEach(r => {
      const val = r.tags[groupByTag] ?? '(untagged)';
      if (!groups.has(val)) groups.set(val, []);
      groups.get(val)!.push(r);
    });
    return Array.from(groups.entries()).sort(([a], [b]) =>
      a === '(untagged)' ? 1 : b === '(untagged)' ? -1 : a.localeCompare(b),
    );
  }, [filteredResources, groupByTag, data]);

  return (
    <Box>
      <Box display="flex" alignItems="center" mb={3} style={{ gap: 12, flexWrap: 'wrap' }}>
        <FormControl variant="outlined" size="small" style={{ minWidth: 200 }}>
          <InputLabel>Region</InputLabel>
          <Select value={region} onChange={e => setRegion(e.target.value as string)} label="Region" disabled={regionsLoading}>
            {regionsLoading
              ? <MenuItem value="all">Loading regions...</MenuItem>
              : [
                <MenuItem key="all" value="all">All Regions</MenuItem>,
                <ListSubheader key="active-header" style={{ lineHeight: '28px', fontSize: 11, color: '#2e7d32' }}>ACTIVE</ListSubheader>,
                ...activeRegions.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>),
                <ListSubheader key="inactive-header" style={{ lineHeight: '28px', fontSize: 11, color: '#9e9e9e' }}>INACTIVE</ListSubheader>,
                ...ALL_AWS_REGIONS.filter(r => !activeRegions.includes(r)).map(r => (
                  <MenuItem key={r} value={r} style={{ color: '#9e9e9e' }}>{r}</MenuItem>
                )),
              ]
            }
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
        {data && untaggedCount > 0 && (
          <Chip
            label={`${untaggedCount} untagged`}
            onClick={() => setShowUntagged(v => !v)}
            style={{
              cursor: 'pointer',
              background: showUntagged ? '#c62828' : '#ffebee',
              color: showUntagged ? '#fff' : '#c62828',
              fontWeight: 600,
            }}
          />
        )}

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
      {data?.timedOutRegions && data.timedOutRegions.length > 0 && (
        <Typography style={{ marginBottom: 16, color: '#e65100', fontSize: 13 }}>
          ⚠ The following regions timed out and were skipped — try scanning them individually: <strong>{data.timedOutRegions.join(', ')}</strong>
        </Typography>
      )}
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
              onEditTags={setToEditTags}
              accountId={accountId}
              awsAccountNumber={awsAccountNumber}
              accessPortalUrl={accessPortalUrl ?? undefined}
              roleName={roleName ?? undefined}
              busy={busy}
              mixed
            />
          </AccordionDetails>
        </Accordion>
      ))}

      {!loading && data && !tagGroups && (['ec2', 'ebs', 'rds', 'elb', 'eip', 's3', 'vpc-endpoint'] as const).map(type => {
        const rows = showUntagged ? data[type].filter(r => getMissingTags(r.tags).length > 0) : data[type];
        return (
        <Accordion key={type} defaultExpanded={rows.length > 0}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box display="flex" alignItems="center" style={{ gap: 12 }}>
              <Typography><strong>{SECTION_LABELS[type]}</strong></Typography>
              <Chip size="small" label={rows.length} />
              {rows.some(r => selected.has(r.resourceId)) && (
                <Chip size="small" label={`${rows.filter(r => selected.has(r.resourceId)).length} selected`} color="secondary" />
              )}
            </Box>
          </AccordionSummary>
          <AccordionDetails style={{ padding: 0 }}>
            <ResourceTable
              rows={rows}
              type={type}
              selected={selected}
              onToggle={handleToggle}
              onSelectAll={handleSelectAll}
              onDelete={setToDelete}
              onEditTags={setToEditTags}
              accountId={accountId}
              awsAccountNumber={awsAccountNumber}
              accessPortalUrl={accessPortalUrl ?? undefined}
              roleName={roleName ?? undefined}
              busy={busy}
            />
          </AccordionDetails>
        </Accordion>
        );
      })}

      <EditTagsDialog
        key={toEditTags?.resourceId ?? 'none'}
        resource={toEditTags}
        accountId={accountId}
        onSaved={handleTagsSaved}
        onCancel={() => setToEditTags(null)}
      />

      <DeleteResourceDialog
        resource={toDelete}
        accountId={accountId}
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
