import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Box, Typography, CircularProgress,
} from '@material-ui/core';
import { useApi } from '@backstage/core-plugin-api';
import { finopsApiRef } from '../../api/FinOpsClient';
import { UnusedResource } from '../../api/types';

interface Props {
  resource: UnusedResource | null;
  accountId: string;
  onSaved: (updatedTags: Record<string, string>) => void;
  onCancel: () => void;
}

const REQUIRED_TAGS = ['team', 'owner', 'environment', 'project'];

export const EditTagsDialog = ({ resource, accountId, onSaved, onCancel }: Props) => {
  const api = useApi(finopsApiRef);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>(() => {
    if (!resource) return {};
    const tags = resource.tags ?? {};
    return Object.fromEntries(
      REQUIRED_TAGS.map(k => {
        const existing = Object.entries(tags).find(([key]) => key.toLowerCase() === k);
        return [k, existing ? existing[1] : ''];
      }),
    );
  });

  if (!resource) return null;

  const handleSave = async () => {
    const toSave = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== ''));
    if (!Object.keys(toSave).length) { setError('At least one tag value is required'); return; }
    setSaving(true);
    setError(null);
    try {
      await api.saveResourceTags(resource.resourceType, resource.resourceId, resource.region, toSave, accountId);
      onSaved({ ...resource.tags, ...toSave });
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>Edit Tags</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="textSecondary" style={{ marginBottom: 12 }}>
          {resource.resourceId}
        </Typography>
        <Box display="flex" flexDirection="column" style={{ gap: 12 }}>
          {REQUIRED_TAGS.map(k => (
            <TextField
              key={k}
              label={k.charAt(0).toUpperCase() + k.slice(1)}
              value={values[k] ?? ''}
              onChange={e => setValues(v => ({ ...v, [k]: e.target.value }))}
              variant="outlined"
              size="small"
              fullWidth
              disabled={saving}
            />
          ))}
        </Box>
        {error && <Typography color="error" variant="body2" style={{ marginTop: 8 }}>{error}</Typography>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving} variant="contained" color="primary">
          {saving ? <CircularProgress size={16} /> : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
