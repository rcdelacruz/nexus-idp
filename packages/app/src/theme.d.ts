import '@material-ui/core/styles/createPalette';

declare module '@material-ui/core/styles/createPalette' {
  interface Palette {
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
