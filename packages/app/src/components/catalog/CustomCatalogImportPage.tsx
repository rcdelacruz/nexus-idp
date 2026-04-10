import React from 'react';
import { Page, Header, Content } from '@backstage/core-components';
import {
  ImportInfoCard,
  ImportStepper,
} from '@backstage/plugin-catalog-import';
import { useTheme } from '@material-ui/core/styles';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import { GitMerge } from 'lucide-react';

const g = {
  bg100:  'var(--ds-background-100)',
  border: 'var(--border)',
  fg1:    'var(--fg-primary)',
  fg2:    'var(--fg-secondary)',
  fg3:    'var(--fg-tertiary)',
};

const CatalogImportContent = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <Page themeId="home">
      <Header
        title="Register a Component"
        subtitle="Add an existing repository to the Nexus IDP catalog"
      />
      <Content>
        {/* Page title row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          paddingBottom: 16,
          marginBottom: 24,
          borderBottom: `1px solid ${g.border}`,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 7,
            background: g.bg100, border: `1px solid ${g.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <GitMerge size={14} strokeWidth={1.5} color={g.fg2} />
          </div>
          <div>
            <div style={{ fontSize: '0.9375rem', fontWeight: 600, letterSpacing: '-0.02em', color: g.fg1, lineHeight: 1.3 }}>
              Start tracking your component in Nexus IDP
            </div>
            <div style={{ fontSize: '0.8125rem', color: g.fg3, letterSpacing: '-0.006em', marginTop: 2 }}>
              Point to a repository with a{' '}
              <code style={{ fontFamily: 'monospace', fontSize: '0.8125rem', background: g.bg100, border: `1px solid ${g.border}`, padding: '1px 5px', borderRadius: 4 }}>
                catalog-info.yaml
              </code>
              {' '}— or let Nexus IDP create one via pull request.
            </div>
          </div>
        </div>

        {/* Two-column layout on desktop, stacked on mobile */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 5fr) minmax(0, 7fr)',
          gap: 16,
          alignItems: 'start',
        }}>
          <div style={{
            background: g.bg100,
            border: `1px solid ${g.border}`,
            borderRadius: 8,
            overflow: 'hidden',
            order: isMobile ? 2 : 1,
          }}>
            <ImportInfoCard />
          </div>

          <div style={{
            background: g.bg100,
            border: `1px solid ${g.border}`,
            borderRadius: 8,
            overflow: 'hidden',
            order: isMobile ? 1 : 2,
          }}>
            <ImportStepper />
          </div>
        </div>
      </Content>
    </Page>
  );
};

export const CustomCatalogImportPage = () => <CatalogImportContent />;
