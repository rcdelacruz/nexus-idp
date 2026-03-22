import React, { PropsWithChildren } from 'react';
import { UnifiedThemeProvider } from '@backstage/theme';
import { stratpointDarkTheme, stratpointLightTheme } from '../../theme';
import useLocalStorage from 'react-use/lib/useLocalStorage';

// Create a context to share theme state
export const ThemeContext = React.createContext<{
  themeId: string;
  setThemeId: (value: string) => void;
}>({
  themeId: 'light',
  setThemeId: () => { },
});

export const ThemeProvider = ({ children }: PropsWithChildren<{}>) => {
  const [themeId, setThemeId] = useLocalStorage<string>('theme', 'dark');
  const theme = themeId === 'dark' ? stratpointDarkTheme : stratpointLightTheme;

  React.useEffect(() => {
    const toggle = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 't') {
        setThemeId(prevThemeId => (prevThemeId === 'dark' ? 'light' : 'dark'));
      }
    };

    window.addEventListener('keydown', toggle);
    return () => window.removeEventListener('keydown', toggle);
  }, [setThemeId]);

  return (
    <ThemeContext.Provider value={{ themeId: themeId || 'light', setThemeId }}>
      <UnifiedThemeProvider theme={theme}>{children}</UnifiedThemeProvider>
    </ThemeContext.Provider>
  );
};
