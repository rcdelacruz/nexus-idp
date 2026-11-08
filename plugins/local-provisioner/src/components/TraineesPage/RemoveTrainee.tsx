import React, { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Typography,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { alertApiRef, useApi } from '@backstage/core-plugin-api';
import { Trash2 } from 'lucide-react';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import { TraineeListRow } from '../../api/types';
import { githubRepoName, LIVE_LAB_STATES } from './helpers';

/**
 * Take a trainee off this list (a trainee who left, a failed run) and, by default, delete their
 * GitHub repo. The server refuses to delete any repo it can't prove is this trainee's own lab
 * repo, and removes nothing when the delete fails.
 */
export function RemoveTrainee({ row, onChanged }: { row: Pick<TraineeListRow, 'traineeEmail' | 'agentId' | 'resourceName' | 'repoUrl' | 'capstone' | 'environment'>; onChanged: () => void }) {
  const api = useApi(localProvisionerApiRef);
  const alertApi = useApi(alertApiRef);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const repoName = githubRepoName(row.repoUrl);
  const [deleteRepo, setDeleteRepo] = useState(true);
  const c = row.capstone;
  const labLive = LIVE_LAB_STATES.includes(row.environment.state);
  const willDelete = Boolean(repoName) && deleteRepo;

  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.removeTrainee({
        agentId: row.agentId,
        resourceName: row.agentId ? row.resourceName : undefined,
        enrollmentId: c?.id,
        deleteRepo: willDelete,
      });
      alertApi.post({
        message: `Removed ${row.traineeEmail}${r.repoDeleted ? ` and deleted ${r.repoDeleted}` : ''}`,
        severity: 'success',
        display: 'transient',
      });
      setOpen(false);
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="outlined"
        data-destructive
        startIcon={<Trash2 size={16} strokeWidth={1.5} />}
        onClick={() => {
          setError(undefined);
          setOpen(true);
        }}
      >
        Remove trainee
      </Button>
      <Dialog open={open} onClose={() => !busy && setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Remove {row.traineeEmail}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" gutterBottom>
            Takes <strong>{row.resourceName}</strong> off this list
            {c ? <> and withdraws their {c.capstone} capstone enrollment (#{c.traineeNo}), freeing the number</> : null}.
          </Typography>
          {repoName ? (
            <FormControlLabel
              control={<Checkbox checked={deleteRepo} onChange={e => setDeleteRepo(e.target.checked)} disabled={busy} />}
              label={
                <Typography variant="body2">
                  Also delete the GitHub repository <strong>{repoName}</strong>. This is permanent: their commits, pull requests and CI
                  history are gone.
                </Typography>
              }
            />
          ) : (
            <Typography variant="body2" color="textSecondary" gutterBottom>
              {row.repoUrl ? `Their repository (${row.repoUrl}) is not on GitHub and is not deleted.` : 'There is no repository to delete.'}
            </Typography>
          )}
          {labLive && (
            <Box mt={1.5}>
              <Alert severity="warning">
                Their lab is still on their laptop ({row.environment.state}). It stays there until they remove it from their Local
                Provisioner page{willDelete ? '; with the repository deleted, its CI runner stops working' : ''}.
              </Alert>
            </Box>
          )}
          {error && (
            <Box mt={1.5}>
              <Alert severity="error">Not removed: {error}</Alert>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy} data-destructive onClick={remove}>
            {busy && 'Removing…'}
            {!busy && (willDelete ? 'Remove and delete repository' : 'Remove')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
