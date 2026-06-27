import React, { useState } from 'react';
import {
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from '@material-ui/core';
import { X } from 'lucide-react';
import { useColors, semantic, borderRadius } from '@stratpoint/theme-utils';
import { ProviderLogo } from './ProviderLogos';
import { ProviderInfo, AddConnectionInput } from '../../api/types';

interface Props {
  provider: ProviderInfo;
  open: boolean;
  onClose: () => void;
  onConnect: (input: AddConnectionInput) => Promise<void>;
}

export function ConnectDialog({ provider, open, onClose, onConnect }: Props) {
  const c = useColors();
  const [label, setLabel] = useState('');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [visibility, setVisibility] = useState<'personal' | 'team'>('personal');
  const [teamRef, setTeamRef] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    if (loading) return;
    setLabel('');
    setCredentials({});
    setVisibility('personal');
    setTeamRef('');
    setError(null);
    onClose();
  };

  const handleConnect = async () => {
    if (!label.trim()) { setError('Label is required'); return; }
    if (label.length > 100) { setError('Label must be 100 characters or fewer'); return; }
    for (const field of provider.credentialFields) {
      if (!credentials[field.key]?.trim()) { setError(`${field.label} is required`); return; }
    }
    if (visibility === 'team') {
      if (!teamRef.trim()) { setError('Team Group Ref is required for team visibility'); return; }
      if (!/^group:[^/]+\/.+$/.test(teamRef.trim())) {
        setError('Team Group Ref must be a valid group entity ref (e.g. group:default/my-team)');
        return;
      }
    }
    setError(null);
    setLoading(true);
    try {
      await onConnect({
        provider: provider.id,
        label: label.trim(),
        credentials,
        visibility,
        teamRef: visibility === 'team' ? teamRef.trim() : undefined,
      });
      handleClose();
    } catch (err: any) {
      setError(err.message ?? 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: 36,
    borderRadius: borderRadius.md,
    border: `1px solid ${c.border}`,
    background: c.inputBg,
    color: c.text,
    fontSize: '0.875rem',
    padding: '0 10px',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="connect-dialog-title"
    >
      {/* Header */}
      <DialogTitle
        id="connect-dialog-title"
        style={{ background: c.surface, borderBottom: `1px solid ${c.border}`, padding: '14px 20px' }}
      >
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box display="flex" alignItems="center" style={{ gap: 10 }}>
            <ProviderLogo providerId={provider.id} size={24} />
            <Typography style={{ fontSize: '0.9375rem', fontWeight: 600, color: c.text }}>
              Connect {provider.displayName}
            </Typography>
          </Box>
          <IconButton
            size="small"
            onClick={handleClose}
            disabled={loading}
            aria-label="Close dialog"
            style={{ color: c.textSecondary }}
          >
            <X size={16} strokeWidth={1.5} />
          </IconButton>
        </Box>
      </DialogTitle>

      {/* Body */}
      <DialogContent style={{ background: c.surfaceSubtle, padding: '20px 24px' }}>
        <Box display="flex" flexDirection="column" style={{ gap: 16, marginTop: 4 }}>

          {/* Label */}
          <Box>
            <FieldLabel>Label</FieldLabel>
            <input
              type="text"
              value={label}
              placeholder={`e.g. My ${provider.displayName} Account`}
              onChange={e => setLabel(e.target.value)}
              style={inputStyle}
              onFocus={e => { e.currentTarget.style.borderColor = c.borderHover; }}
              onBlur={e => { e.currentTarget.style.borderColor = c.border; }}
            />
          </Box>

          {/* Credential fields */}
          {provider.credentialFields.map(field => (
            <Box key={field.key}>
              <FieldLabel>{field.label}</FieldLabel>
              <input
                type={field.type}
                value={credentials[field.key] ?? ''}
                placeholder={field.placeholder}
                onChange={e => setCredentials(prev => ({ ...prev, [field.key]: e.target.value }))}
                style={inputStyle}
                onFocus={e => { e.currentTarget.style.borderColor = c.borderHover; }}
                onBlur={e => { e.currentTarget.style.borderColor = c.border; }}
              />
              {field.helpText && (
                <Typography style={{ fontSize: '0.75rem', color: c.textMuted, marginTop: 5, lineHeight: 1.4 }}>
                  {field.helpText}
                </Typography>
              )}
            </Box>
          ))}

          {/* Visibility */}
          <Box>
            <FieldLabel>Visibility</FieldLabel>
            <Box display="flex" style={{ gap: 20 }}>
              {(['personal', 'team'] as const).map(val => (
                <label
                  key={val}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
                >
                  <input
                    type="radio"
                    value={val}
                    checked={visibility === val}
                    onChange={() => setVisibility(val)}
                    style={{ accentColor: c.text, width: 14, height: 14, cursor: 'pointer' }}
                  />
                  <Typography component="span" style={{ fontSize: '0.875rem', color: c.text }}>
                    {val === 'personal' ? (
                      <>Personal <span style={{ color: c.textMuted, fontSize: '0.8125rem' }}>(only you)</span></>
                    ) : 'Team'}
                  </Typography>
                </label>
              ))}
            </Box>
          </Box>

          {/* Team ref */}
          {visibility === 'team' && (
            <Box>
              <FieldLabel>Team Group Ref</FieldLabel>
              <input
                type="text"
                value={teamRef}
                placeholder="e.g. group:default/backend-team"
                onChange={e => setTeamRef(e.target.value)}
                style={inputStyle}
                onFocus={e => { e.currentTarget.style.borderColor = c.borderHover; }}
                onBlur={e => { e.currentTarget.style.borderColor = c.border; }}
              />
              <Typography style={{ fontSize: '0.75rem', color: c.textMuted, marginTop: 5 }}>
                Catalog group entity reference (group:default/&lt;name&gt;)
              </Typography>
            </Box>
          )}

          {/* Error */}
          {error && (
            <Box
              role="alert"
              style={{
                background: `${semantic.error}14`,
                border: `1px solid ${semantic.error}50`,
                borderRadius: borderRadius.md,
                padding: '8px 12px',
              }}
            >
              <Typography style={{ fontSize: '0.875rem', color: semantic.error }}>{error}</Typography>
            </Box>
          )}
        </Box>
      </DialogContent>

      {/* Footer */}
      <Box
        display="flex"
        justifyContent="flex-end"
        style={{ gap: 8, padding: '12px 24px', borderTop: `1px solid ${c.border}`, background: c.surface }}
      >
        <button
          onClick={handleClose}
          disabled={loading}
          style={{
            height: 32, padding: '0 12px', borderRadius: borderRadius.md,
            border: `1px solid ${c.border}`, background: 'transparent',
            color: c.textSecondary, fontSize: '0.875rem', fontWeight: 500,
            fontFamily: 'inherit', cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.5 : 1,
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleConnect}
          disabled={loading}
          style={{
            height: 32, padding: '0 12px', borderRadius: borderRadius.md,
            border: 'none', background: c.text,
            color: c.surface, fontSize: '0.875rem', fontWeight: 500,
            fontFamily: 'inherit', cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
            minWidth: 130, display: 'inline-flex', alignItems: 'center',
            justifyContent: 'center', gap: 6,
          }}
        >
          {loading && <CircularProgress size={13} style={{ color: c.surface }} />}
          {loading ? 'Connecting…' : `Connect ${provider.displayName}`}
        </button>
      </Box>
    </Dialog>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const FieldLabel = ({ children }: { children: React.ReactNode }) => {
  const c = useColors();
  return (
    <Typography
      style={{
        fontSize: '0.6875rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: c.textSecondary,
        marginBottom: 6,
      }}
    >
      {children}
    </Typography>
  );
};
