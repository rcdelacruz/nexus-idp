import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent,
  DialogActions, Button, Typography, Box, CircularProgress, List, ListItem, ListItemIcon, ListItemText,
  FormControlLabel, Checkbox,
} from '@material-ui/core';
import ErrorOutlineIcon from '@material-ui/icons/ErrorOutline';
import WarningIcon from '@material-ui/icons/Warning';
import CheckCircleOutlineIcon from '@material-ui/icons/CheckCircleOutline';
import InfoOutlinedIcon from '@material-ui/icons/InfoOutlined';
import { useApi } from '@backstage/core-plugin-api';
import { finopsApiRef } from '../../api/FinOpsClient';
import { UnusedResource } from '../../api/types';

interface Props {
  resource: UnusedResource | null;
  accountId: string;
  onConfirm: (force: boolean) => void;
  onCancel: () => void;
  deleting: boolean;
}

interface DependencyResult {
  blockers: string[];
  warnings: string[];
  info: string[];
  safe: boolean;
}

export const DeleteResourceDialog = ({ resource, accountId, onConfirm, onCancel, deleting }: Props) => {
  const api = useApi(finopsApiRef);
  const [deps, setDeps] = useState<DependencyResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [forceDelete, setForceDelete] = useState(false);

  useEffect(() => {
    if (!resource) { setDeps(null); return; }
    setChecking(true);
    setDeps(null);
    api.checkDependencies(resource.resourceType, resource.resourceId, resource.region, accountId)
      .then(d => { setDeps(d); setChecking(false); })
      .catch(() => { setDeps({ blockers: [], warnings: ['Could not check dependencies.'], info: [], safe: true }); setChecking(false); });
  }, [resource, api]);

  if (!resource) return null;

  const label = resource.resourceName && resource.resourceName !== resource.resourceId
    ? `${resource.resourceName} (${resource.resourceId})`
    : resource.resourceId;

  const hasBlockers = (deps?.blockers ?? []).length > 0;
  const canDelete = !checking && (!hasBlockers || forceDelete);

  return (
    <Dialog open onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>Delete {resource.resourceType.toUpperCase()} Resource</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="textSecondary">Resource</Typography>
        <Typography variant="body1" style={{ fontFamily: 'monospace', margin: '4px 0 12px', wordBreak: 'break-all' }}>
          {label}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          Region: <strong>{resource.region}</strong>
        </Typography>

        <Box mt={2}>
          {checking && (
            <Box display="flex" alignItems="center" style={{ gap: 8 }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="textSecondary">Checking dependencies...</Typography>
            </Box>
          )}

          {deps && !checking && (
            <>
              {deps.blockers.length === 0 && deps.warnings.length === 0 && (
                <Box display="flex" alignItems="center" style={{ gap: 8, color: '#2e7d32' }}>
                  <CheckCircleOutlineIcon fontSize="small" />
                  <Typography variant="body2">No blockers found — safe to delete.</Typography>
                </Box>
              )}

              {deps.blockers.length > 0 && (
                <Box mb={1}>
                  <Typography variant="body2" style={{ fontWeight: 600, color: '#c62828', marginBottom: 4 }}>
                    Blockers — must resolve before deleting:
                  </Typography>
                  <List dense disablePadding>
                    {deps.blockers.map((b, i) => (
                      <ListItem key={i} disableGutters>
                        <ListItemIcon style={{ minWidth: 28 }}>
                          <ErrorOutlineIcon fontSize="small" style={{ color: '#c62828' }} />
                        </ListItemIcon>
                        <ListItemText primary={<Typography variant="body2">{b}</Typography>} />
                      </ListItem>
                    ))}
                  </List>
                </Box>
              )}

              {deps.warnings.length > 0 && (
                <Box>
                  <Typography variant="body2" style={{ fontWeight: 600, color: '#e65100', marginBottom: 4 }}>
                    Warnings — review before proceeding:
                  </Typography>
                  <List dense disablePadding>
                    {deps.warnings.map((w, i) => (
                      <ListItem key={i} disableGutters>
                        <ListItemIcon style={{ minWidth: 28 }}>
                          <WarningIcon fontSize="small" style={{ color: '#e65100' }} />
                        </ListItemIcon>
                        <ListItemText primary={<Typography variant="body2">{w}</Typography>} />
                      </ListItem>
                    ))}
                  </List>
                </Box>
              )}

              {(deps.info ?? []).length > 0 && (
                <Box mt={deps.warnings.length > 0 ? 1 : 0}>
                  <List dense disablePadding>
                    {deps.info.map((note, i) => (
                      <ListItem key={i} disableGutters>
                        <ListItemIcon style={{ minWidth: 28 }}>
                          <InfoOutlinedIcon fontSize="small" style={{ color: '#1976d2' }} />
                        </ListItemIcon>
                        <ListItemText primary={<Typography variant="body2" style={{ color: '#1976d2' }}>{note}</Typography>} />
                      </ListItem>
                    ))}
                  </List>
                </Box>
              )}
            </>
          )}
        </Box>

        {hasBlockers && (
          <Box mt={2}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={forceDelete}
                  onChange={e => setForceDelete(e.target.checked)}
                  color="secondary"
                />
              }
              label={
                <Typography variant="body2">
                  {resource.resourceType === 's3'
                    ? 'Force delete — permanently delete ALL objects in this bucket, then delete the bucket'
                    : 'Force delete — proceed despite blockers'}
                </Typography>
              }
            />
          </Box>
        )}

        {canDelete && (
          <Typography variant="body2" style={{ color: '#e53935', marginTop: 16 }}>
            This action <strong>cannot be undone</strong>.
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={deleting}>Cancel</Button>
        <Button
          onClick={() => onConfirm(forceDelete)}
          disabled={!canDelete || deleting}
          variant="contained"
          style={canDelete ? { background: '#e53935', color: '#fff' } : {}}
        >
          {deleting ? 'Deleting...' : !canDelete && hasBlockers ? 'Cannot Delete' : forceDelete ? 'Force Delete' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
