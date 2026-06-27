import React, { useCallback, useEffect, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { Box, CircularProgress, Typography } from '@material-ui/core';
import { Database, AlertTriangle } from 'lucide-react';
import { useColors, semantic, borderRadius } from '@stratpoint/theme-utils';
import { dbaasApiRef } from '../../api/DbaasApi';
import { ProviderInfo, DbaasConnection, AddConnectionInput } from '../../api/types';
import { ConnectedCard, AvailableCard } from './ProviderCard';
import { ConnectDialog } from './ConnectDialog';

const SectionLabel = ({ children }: { children: React.ReactNode }) => {
  const c = useColors();
  return (
    <Typography
      style={{
        fontSize: '0.6875rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: c.textSecondary,
        marginBottom: 12,
      }}
    >
      {children}
    </Typography>
  );
};

export function ConnectDatabasesPage() {
  const api = useApi(dbaasApiRef);
  const c = useColors();

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [connections, setConnections] = useState<DbaasConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogProvider, setDialogProvider] = useState<ProviderInfo | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [prov, conns] = await Promise.all([api.getProviders(), api.getConnections()]);
      setProviders(prov);
      setConnections(conns);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const handleConnect = async (input: AddConnectionInput) => {
    await api.addConnection(input);
    await load();
  };

  const handleSync = async (connectionId: string) => {
    await api.syncConnection(connectionId);
    const conns = await api.getConnections();
    setConnections(conns);
  };

  const handleDisconnect = async (connectionId: string) => {
    await api.deleteConnection(connectionId);
    setConnections(prev => prev.filter(cx => cx.id !== connectionId));
  };

  const connectedProviderIds = new Set(connections.map(cx => cx.provider));
  const connectedProviders = providers.filter(p => connectedProviderIds.has(p.id));
  const availableProviders = providers.filter(p => !connectedProviderIds.has(p.id));
  const getConnectionsFor = (id: string) => connections.filter(cx => cx.provider === id);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" style={{ padding: '48px 0' }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <Box style={{ maxWidth: 860, paddingBottom: 48 }}>

      {/* Page description */}
      <Typography style={{ fontSize: '0.875rem', color: c.textSecondary, lineHeight: 1.6, marginBottom: 32 }}>
        Link your database provider accounts to auto-discover and track databases
        in the catalog. Connected databases are registered as Resources and visible
        to you or your team.
      </Typography>

      {/* Error banner */}
      {error && (
        <Box
          display="flex"
          alignItems="center"
          style={{
            gap: 8,
            background: `${semantic.error}12`,
            border: `1px solid ${semantic.error}40`,
            borderRadius: borderRadius.lg,
            padding: '8px 16px',
            marginBottom: 24,
          }}
        >
          <AlertTriangle size={14} strokeWidth={1.5} color={semantic.error} />
          <Typography style={{ fontSize: '0.875rem', color: semantic.error }}>{error}</Typography>
        </Box>
      )}

      {/* Connected section */}
      {connectedProviders.length > 0 && (
        <Box component="section" style={{ marginBottom: 32 }}>
          <SectionLabel>Connected</SectionLabel>
          <Box
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 12,
            }}
          >
            {connectedProviders.map(provider =>
              getConnectionsFor(provider.id).map(conn => (
                <ConnectedCard
                  key={conn.id}
                  provider={provider}
                  connection={conn}
                  onSync={() => handleSync(conn.id)}
                  onDisconnect={() => handleDisconnect(conn.id)}
                />
              ))
            )}
          </Box>
        </Box>
      )}

      {/* Available section */}
      {availableProviders.length > 0 && (
        <Box component="section">
          <SectionLabel>
            {connectedProviders.length > 0 ? 'Available' : 'Available Providers'}
          </SectionLabel>
          <Box
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
              gap: 12,
            }}
          >
            {availableProviders.map(provider => (
              <AvailableCard
                key={provider.id}
                provider={provider}
                onConnect={() => setDialogProvider(provider)}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Empty state */}
      {!loading && providers.length === 0 && (
        <Box
          display="flex"
          flexDirection="column"
          alignItems="center"
          style={{ padding: '64px 0', color: c.textMuted }}
        >
          <Database size={36} strokeWidth={1} style={{ marginBottom: 12, opacity: 0.4 }} />
          <Typography style={{ fontSize: '0.875rem', color: c.textMuted }}>
            No providers available
          </Typography>
        </Box>
      )}

      {/* Connect dialog */}
      {dialogProvider && (
        <ConnectDialog
          provider={dialogProvider}
          open
          onClose={() => setDialogProvider(null)}
          onConnect={handleConnect}
        />
      )}
    </Box>
  );
}
