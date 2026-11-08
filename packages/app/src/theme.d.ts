import '@material-ui/core/styles/createPalette';

declare module '@material-ui/core/styles/createPalette' {
  interface Palette {
    /** Id of the Settings → Appearance theme this MUI theme was built for (see packages/theme-utils/src/palettes.ts). */
    nexusTheme?: string;
    navigation: {
      background: string;
      indicator: string;
      color: string;
      selectedColor: string;
      navItem: {
        hoverBackground: string;
      };
      submenu: {
        background: string;
      };
    };
  }

  interface PaletteOptions {
    nexusTheme?: string;
    navigation?: {
      background?: string;
      indicator?: string;
      color?: string;
      selectedColor?: string;
      navItem?: {
        hoverBackground?: string;
      };
      submenu?: {
        background?: string;
      };
    };
  }
}
