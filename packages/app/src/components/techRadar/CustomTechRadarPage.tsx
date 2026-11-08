import React from 'react';
import { Page, Header, Content } from '@backstage/core-components';
import { ExternalLink } from 'lucide-react';
import { useColors } from '@stratpoint/theme-utils';
import { TechRadarView, useIsWide } from './TechRadarView';
import { useRadar } from './useRadar';
import { useRadarUrlState } from './useRadarUrlState';

const Message = ({ children }: { children: React.ReactNode }) => {
  const c = useColors();
  return (
    <div style={{ border: `1px solid ${c.border}`, borderRadius: 8, background: c.surface, padding: 24, color: c.textSecondary, fontSize: '0.875rem' }}>
      {children}
    </div>
  );
};

/** /tech-radar: the Thoughtworks Technology Radar, explorable. State lives in the URL. */
export const CustomTechRadarPage = () => {
  const c = useColors();
  const radar = useRadar();
  const { state, update } = useRadarUrlState();
  const wide = useIsWide(1280);

  const subtitle = radar.status === 'ready' ? `Thoughtworks Technology Radar · ${radar.radar.volumeLabel}` : 'Thoughtworks Technology Radar';

  let content: React.ReactNode;
  if (radar.status === 'loading') {
    content = <Message>Loading the radar…</Message>;
  } else if (radar.status === 'error') {
    content = (
      <Message>
        <div role="alert" style={{ color: c.text, fontWeight: 600, marginBottom: 6 }}>The radar could not be loaded.</div>
        <div style={{ marginBottom: 14 }}>{radar.message}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={radar.retry}
            style={{ height: 32, padding: '0 14px', borderRadius: 6, border: `1px solid ${c.text}`, background: c.text, color: c.bg, fontWeight: 500, fontSize: '0.8125rem', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Try again
          </button>
          <a href="https://www.thoughtworks.com/radar" target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: c.blue, fontSize: '0.8125rem', textDecoration: 'none' }}>
            <ExternalLink size={14} strokeWidth={1.5} aria-hidden="true" /> Open the radar on thoughtworks.com
          </a>
        </div>
      </Message>
    );
  } else {
    content = <TechRadarView radar={radar.radar} stale={radar.stale} state={state} wide={wide} onChange={update} />;
  }

  return (
    <Page themeId="tool">
      <Header title="Tech Radar" subtitle={subtitle} />
      <Content>{content}</Content>
    </Page>
  );
};
