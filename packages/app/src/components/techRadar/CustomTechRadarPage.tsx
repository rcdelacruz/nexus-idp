import React, { useMemo, useState, useEffect } from 'react';
import { Page, Header, Content } from '@backstage/core-components';
import { TechRadarComponent, techRadarApiRef } from '@backstage-community/plugin-tech-radar';
import { createTheme, ThemeProvider, useTheme } from '@material-ui/core/styles';
import { useApi } from '@backstage/core-plugin-api';
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
        <NarrowDialogProvider>
          <TechRadarComponent width={1500} height={800} />
        </NarrowDialogProvider>
      </Content>
    </Page>
  );
};
