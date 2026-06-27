import React, { useState } from 'react';
import { Box, CircularProgress, IconButton, Typography } from '@material-ui/core';
import { CheckCircle2, RefreshCw, Trash2, AlertTriangle } from 'lucide-react';
import { useColors, semantic, badge, borderRadius } from '@stratpoint/theme-utils';
import { ProviderLogo } from './ProviderLogos';
import { ProviderInfo, DbaasConnection } from '../../api/types';

// ── Connected Card ─────────────────────────────────────────────────────────────

interface ConnectedCardProps {
  provider: ProviderInfo;
  connection: DbaasConnection;
  onSync: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export function ConnectedCard({ provider, connection, onSync, onDisconnect }: ConnectedCardProps) {
  const c = useColors();
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try { await onSync(); } finally { setSyncing(false); }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try { await onDisconnect(); } finally { setDisconnecting(false); }
  };

  const hasError = !!connection.lastError;
  const lastSyncedText = connection.lastSynced
    ? `Synced ${new Date(connection.lastSynced).toLocaleString()}`
    : 'Never synced';

  return (
    <Box
      style={{
        background: c.surface,
        border: `1px solid ${c.border}`,
        borderRadius: borderRadius.lg,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Header row */}
      <Box display="flex" alignItems="flex-start" style={{ gap: 12 }}>
        <ProviderLogo providerId={provider.id} size={36} />
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Typography style={{ fontSize: '0.875rem', fontWeight: 600, color: c.text, lineHeight: 1.3 }}>
            {connection.label}
          </Typography>
          <Typography style={{ fontSize: '0.75rem', color: c.textSecondary, marginTop: 2 }}>
            {provider.displayName}
          </Typography>
        </Box>
        {hasError ? (
          <span title={connection.lastError ?? ''} style={{ flexShrink: 0, lineHeight: 0 }}>
            <AlertTriangle size={14} strokeWidth={1.5} color={semantic.error} />
          </span>
        ) : (
          <span style={{ flexShrink: 0, lineHeight: 0 }}>
            <CheckCircle2 size={14} strokeWidth={1.5} color={semantic.success} />
          </span>
        )}
      </Box>

      {/* Engine + visibility badges */}
      <Box display="flex" style={{ flexWrap: 'wrap', gap: 4 }}>
        {provider.engines.map(e => (
          <span key={e} style={badge('gray')}>{e}</span>
        ))}
        <span style={badge(connection.visibility === 'team' ? 'blue' : 'gray')}>
          {connection.visibility === 'team' ? 'Team' : 'Personal'}
        </span>
      </Box>

      {/* Last synced */}
      <Typography style={{ fontSize: '0.6875rem', color: c.textMuted }}>
        {lastSyncedText}
      </Typography>

      {/* Actions */}
      <Box display="flex" style={{ gap: 8, marginTop: 4 }}>
        <button
          disabled={syncing}
          onClick={handleSync}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            height: 32,
            borderRadius: borderRadius.md,
            border: `1px solid ${c.border}`,
            background: 'transparent',
            color: c.text,
            fontSize: '0.8125rem',
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: syncing ? 'not-allowed' : 'pointer',
            opacity: syncing ? 0.5 : 1,
          }}
        >
          {syncing
            ? <CircularProgress size={12} style={{ color: c.textSecondary }} />
            : <RefreshCw size={12} strokeWidth={1.5} />}
          {syncing ? 'Syncing…' : 'Refresh'}
        </button>

        <IconButton
          title="Disconnect"
          disabled={disconnecting}
          onClick={handleDisconnect}
          size="small"
          aria-label={`Disconnect ${connection.label}`}
          style={{
            width: 32,
            height: 32,
            borderRadius: borderRadius.md,
            border: `1px solid ${semantic.error}4d`,
            background: 'transparent',
            color: semantic.error,
            opacity: disconnecting ? 0.5 : 1,
          }}
        >
          {disconnecting
            ? <CircularProgress size={12} style={{ color: semantic.error }} />
            : <Trash2 size={12} strokeWidth={1.5} />}
        </IconButton>
      </Box>
    </Box>
  );
}

// ── Available Card ─────────────────────────────────────────────────────────────

interface AvailableCardProps {
  provider: ProviderInfo;
  onConnect: () => void;
}

export function AvailableCard({ provider, onConnect }: AvailableCardProps) {
  const c = useColors();
  const [hovered, setHovered] = useState(false);

  return (
    <Box
      style={{
        background: c.surface,
        border: `1px solid ${hovered ? c.borderHover : c.border}`,
        borderRadius: borderRadius.lg,
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        transition: 'border-color 0.15s',
        cursor: 'default',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header */}
      <Box display="flex" alignItems="center" style={{ gap: 12 }}>
        <ProviderLogo providerId={provider.id} size={36} />
        <Box>
          <Typography style={{ fontSize: '0.875rem', fontWeight: 600, color: c.text, lineHeight: 1.3 }}>
            {provider.displayName}
          </Typography>
          <Typography style={{ fontSize: '0.75rem', color: c.textSecondary, lineHeight: 1.4, marginTop: 2 }}>
            {provider.description}
          </Typography>
        </Box>
      </Box>

      {/* Engine badges */}
      <Box display="flex" style={{ flexWrap: 'wrap', gap: 4 }}>
        {provider.engines.map(e => (
          <span key={e} style={badge('gray')}>{e}</span>
        ))}
      </Box>

      {/* Connect button */}
      <button
        onClick={onConnect}
        style={{
          height: 32,
          borderRadius: borderRadius.md,
          border: `1px solid ${c.border}`,
          background: 'transparent',
          color: c.text,
          fontSize: '0.8125rem',
          fontWeight: 500,
          fontFamily: 'inherit',
          cursor: 'pointer',
          transition: 'border-color 0.15s, background 0.15s',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = c.borderHover;
          (e.currentTarget as HTMLButtonElement).style.background = c.hoverBg;
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = c.border;
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }}
      >
        Connect
      </button>
    </Box>
  );
}
