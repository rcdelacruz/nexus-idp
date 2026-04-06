import React, { useMemo, useState, useEffect } from 'react';
import { Page, Header, Content } from '@backstage/core-components';
import { TechRadarComponent, techRadarApiRef } from '@backstage-community/plugin-tech-radar';
import { createTheme, ThemeProvider, useTheme } from '@material-ui/core/styles';
import { Box, Typography } from '@material-ui/core';
import { useApi } from '@backstage/core-plugin-api';
import { useColors } from '@stratpoint/theme-utils';
import { ThoughtworksTechRadarApi } from './ThoughtworksTechRadarApi';

const NarrowDialogProvider = ({ children }: { children: React.ReactNode }) => {
  const base = useTheme();
  const theme = useMemo(
    () =>
      createTheme(base, {
        overrides: {
          MuiDialog: {
            paperWidthLg: { maxWidth: 720 },
            paperFullWidth: { width: 720 },
          },
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
};

export const CustomTechRadarPage = () => {
  const api = useApi(techRadarApiRef) as ThoughtworksTechRadarApi;
  const c = useColors();
  const [subtitle, setSubtitle] = useState('Thoughtworks Technology Radar');

  useEffect(() => {
    api.load().then(() => {
      setSubtitle(api.volumeLabel);
    }).catch(() => {});
  }, [api]);

  return (
    <Page themeId="tool">
      <Header title="Tech Radar" subtitle={subtitle} />
      <Content>
        <Box style={{
          background: c.surface, border: `1px solid ${c.border}`, borderRadius: 8,
          padding: '14px 20px', marginBottom: 24,
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <Box>
            <Typography style={{ fontSize: '0.875rem', fontWeight: 600, color: c.text, marginBottom: 4 }}>
              What is the Tech Radar?
            </Typography>
            <Typography style={{ fontSize: '0.8125rem', color: c.textMuted, lineHeight: 1.6, maxWidth: 860 }}>
              The Thoughtworks Technology Radar is a guide to the tools, techniques, platforms, and languages our industry uses.
              Each technology is placed in one of four rings: <strong style={{ color: c.text }}>Adopt</strong> (proven, recommended),{' '}
              <strong style={{ color: c.text }}>Trial</strong> (worth exploring), <strong style={{ color: c.text }}>Assess</strong> (worth watching),
              or <strong style={{ color: c.text }}>Hold</strong> (use with caution). Click any item on the radar to learn more.
            </Typography>
          </Box>
        </Box>
        <NarrowDialogProvider>
          <TechRadarComponent width={1500} height={800} />
        </NarrowDialogProvider>
      </Content>
    </Page>
  );
};
