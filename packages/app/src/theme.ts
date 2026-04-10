import {
  createUnifiedTheme,
  createBaseThemeOptions,
  palettes,
  genPageTheme,
} from '@backstage/theme';

const geistFont = '"Geist", "Helvetica Neue", Arial, sans-serif';
const geistMono = '"Geist Mono", "Fira Code", "Courier New", monospace';

// Geist semantic colors — keep in sync with packages/theme-utils/src/index.ts
const COMPLETED_DARK  = '#50e3c2';
const COMPLETED_LIGHT = '#079669';

// Exact Vercel Geist dark mode design tokens
const D = {
  bg:          '#000000',
  surface:     '#0a0a0a',
  surfaceHover:'#1a1a1a',
  border:      '#2e2e2e',
  borderHover: '#454545',
  textPrimary: '#ededed',
  textSecondary:'#a1a1a1',
  textTertiary: '#878787',
  textDisabled: '#454545',
  blue:        '#3291ff',
  blueDark:    '#0070f3',
};

// Exact Vercel Geist light mode design tokens
const L = {
  bg:          '#fafafa',
  surface:     '#ffffff',
  surfaceHover:'#f5f5f5',
  border:      '#e5e5e5',
  borderHover: '#c9c9c9',
  textPrimary: '#171717',
  textSecondary:'#4d4d4d',
  textTertiary: '#8f8f8f',
  textDisabled: '#c9c9c9',
  blue:        '#0070f3',
  blueDark:    '#0060df',
};

// Flat page theme — no wave, no gradient
const flat = genPageTheme({ colors: ['#000000', '#000000'], shape: 'none' as any });
const flatLight = genPageTheme({ colors: ['#fafafa', '#fafafa'], shape: 'none' as any });

const makeComponents = (isDark: boolean) => {
  const c = isDark ? D : L;

  return {
    // ---- Global ----
    MuiCssBaseline: {
      styleOverrides: {
        '*': {
          boxSizing: 'border-box',
          minWidth: 0,
        },
        'code, pre, kbd, samp': {
          fontFamily: `${geistMono} !important`,
        },
        'pre *, code *': {
          fontFamily: `${geistMono} !important`,
        },
        body: {
          fontFamily: geistFont,
          backgroundColor: c.bg,
          color: c.textPrimary,
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        },
        // Disable Material ripple effect
        '.MuiTouchRipple-root': { display: 'none !important' },
        // Scrollbar
        '*::-webkit-scrollbar': { width: 4, height: 4 },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
        '*::-webkit-scrollbar-thumb': {
          background: c.border,
          borderRadius: 99,
        },
      },
    },

    // ---- Paper / surface ----
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: 8,
          boxShadow: isDark ? 'none' : '0 2px 4px rgba(0,0,0,0.04)',
          color: c.textPrimary,
        },
      },
    },

    // ---- Card ----
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: c.surface,
          border: `1px solid ${c.border}`,
          boxShadow: isDark ? 'none' : '0 2px 4px rgba(0,0,0,0.04)',
          borderRadius: 8,
        },
      },
    },
    MuiCardHeader: {
      styleOverrides: {
        root: {
          borderBottom: `1px solid ${c.border}`,
          padding: '12px 20px',
        },
        title: {
          fontSize: '0.9375rem',
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: c.textPrimary,
        },
        subheader: {
          fontSize: '0.875rem',
          color: c.textSecondary,
          marginTop: 2,
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: '20px',
          '&:last-child': { paddingBottom: '20px' },
        },
      },
    },

    // ---- Buttons (Geist medium = 40px height) ----
    MuiButton: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          fontWeight: 500,
          fontSize: '0.875rem',
          letterSpacing: '-0.006em',
          textTransform: 'none',
          borderRadius: 6,
          boxShadow: 'none',
          height: 40,
          minHeight: 40,
          padding: '0 16px',
          transition: 'background 0.15s ease, box-shadow 0.15s ease, color 0.15s ease, transform 0.15s ease',
          '&:hover': { boxShadow: 'none' },
          '&:active': { transform: 'translateY(1px)' },
        },
        contained: { boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
        containedPrimary: {
          backgroundColor: isDark ? '#ededed' : '#171717',
          color: isDark ? '#000000' : '#ffffff',
          '&:hover': { backgroundColor: isDark ? '#d4d4d4' : '#383838', boxShadow: 'none' },
        },
        outlined: {
          border: 'none',
          boxShadow: `0 0 0 1px ${c.border} inset`,
          color: c.textPrimary,
          backgroundColor: 'transparent',
          '&:hover': {
            border: 'none',
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            boxShadow: `0 0 0 1px ${c.borderHover} inset`,
          },
        },
        outlinedPrimary: {
          border: 'none',
          boxShadow: `0 0 0 1px ${c.border} inset`,
          color: c.textPrimary,
          '&:hover': {
            border: 'none',
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            boxShadow: `0 0 0 1px ${c.borderHover} inset`,
          },
        },
        text: {
          color: c.textSecondary,
          '&:hover': {
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            color: c.textPrimary,
          },
        },
        sizeSmall: { height: 32, fontSize: '0.8125rem', padding: '0 10px', minHeight: 32 },
        sizeLarge: { height: 48, fontSize: '1rem', padding: '0 20px', minHeight: 48, borderRadius: 8 },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          color: c.textTertiary,
          borderRadius: 6,
          padding: 8,
          '&:hover': {
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
            color: c.textPrimary,
          },
          // Constrain MUI SVG icons inside buttons to match lucide sizing
          '& .MuiSvgIcon-root': {
            fontSize: '1.125rem',
          },
        },
        sizeSmall: {
          padding: 6,
          '& .MuiSvgIcon-root': {
            fontSize: '1rem',
          },
        },
      },
    },
    // MUI SVG icons — make them thinner and smaller to blend with lucide
    MuiSvgIcon: {
      styleOverrides: {
        root: {
          fontSize: '1.25rem',
        },
        fontSizeSmall: {
          fontSize: '1rem',
        },
      },
    },

    // ---- Inputs (Geist medium = 40px height) ----
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          fontSize: '0.875rem',
          borderRadius: 6,
          backgroundColor: isDark ? '#0a0a0a' : '#ffffff',
          color: c.textPrimary,
          // No height here — fixed height breaks multiline inputs and floating labels.
          // Single-line height (40px) is enforced via the input slot padding instead.
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: c.borderHover },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: c.blue,
            borderWidth: 1,
          },
          '&.Mui-focused': {
            boxShadow: `0 0 0 3px ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,112,243,0.12)'}`,
          },
        },
        notchedOutline: {
          borderColor: c.border,
        },
        input: {
          color: c.textPrimary,
          padding: '10px 14px',
          '&::placeholder': { color: c.textTertiary, opacity: 1 },
        },
      },
    },
    MuiInputBase: {
      styleOverrides: {
        root: { fontFamily: geistFont, fontSize: '0.875rem', color: c.textPrimary },
        input: { '&::placeholder': { color: c.textTertiary, opacity: 1 } },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: { fontFamily: geistFont, fontSize: '0.875rem', color: c.textSecondary },
        focused: { color: `${c.blue} !important` },
      },
    },
    MuiFormLabel: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          fontSize: '0.875rem',
          color: c.textSecondary,
          '&.Mui-focused': { color: c.blue },
        },
      },
    },
    MuiFormHelperText: {
      styleOverrides: {
        root: { fontFamily: geistFont, fontSize: '0.75rem', color: c.textTertiary, marginTop: 4 },
      },
    },
    MuiSelect: {
      styleOverrides: {
        icon: { color: c.textTertiary },
      },
    },

    // ---- Checkbox / Radio / Switch ----
    MuiCheckbox: {
      styleOverrides: {
        root: {
          color: c.border,
          '&.Mui-checked': { color: c.blue },
        },
      },
    },
    MuiRadio: {
      styleOverrides: {
        root: {
          color: c.border,
          '&.Mui-checked': { color: c.blue },
        },
      },
    },

    // ---- Chips ----
    MuiChip: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          fontSize: '0.75rem',
          fontWeight: 500,
          borderRadius: 4,
          height: 24,
        },
        label: { paddingLeft: 8, paddingRight: 8 },
      },
    },

    // ---- Tables ----
    MuiTableCell: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          fontSize: '0.875rem',
          letterSpacing: '-0.006em',
          borderBottom: `1px solid ${c.border}`,
          color: c.textPrimary,
          padding: '16px 20px',
          lineHeight: 1.5,
        },
        head: {
          fontWeight: 500,
          fontSize: '0.75rem',
          color: c.textSecondary,
          backgroundColor: isDark ? '#0a0a0a' : '#fafafa',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          borderBottom: `1px solid ${c.border}`,
          padding: '12px 20px',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover > td': { backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)' },
          '&:last-child > td': { borderBottom: 0 },
        },
      },
    },
    MuiTablePagination: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          color: c.textSecondary,
          borderTop: `1px solid ${c.border}`,
          fontSize: '0.875rem',
        },
      },
    },

    // ---- Tabs ----
    MuiTab: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          fontSize: '0.875rem',
          fontWeight: 500,
          letterSpacing: '-0.006em',
          textTransform: 'none',
          minWidth: 'unset',
          padding: '12px 20px',
          color: c.textTertiary,
          opacity: 1,
          '&.Mui-selected': { color: c.textPrimary },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { borderBottom: `1px solid ${c.border}` },
        indicator: { backgroundColor: c.textPrimary, height: 1 },
      },
    },

    // ---- Divider ----
    MuiDivider: {
      styleOverrides: {
        root: { backgroundColor: c.border, borderColor: c.border },
      },
    },

    // ---- Drawer (K8s plugin, ArgoCD details) ----
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: 0,
          boxShadow: isDark ? '0 24px 64px rgba(0,0,0,0.8)' : '0 24px 64px rgba(0,0,0,0.12)',
          color: c.textPrimary,
          // K8s plugin sets padding via makeStyles (20px). We want 24px.
          padding: '24px !important',
          overflowY: 'auto',
          '& .MuiTypography-h5': {
            fontFamily: geistFont,
            fontSize: '1.125rem',
            fontWeight: 600,
            letterSpacing: '-0.025em',
            color: c.textPrimary,
            marginBottom: 4,
          },
          '& .MuiTypography-subtitle1': {
            fontFamily: geistFont,
            fontSize: '0.8125rem',
            color: c.textSecondary,
            letterSpacing: '-0.006em',
          },
          '& .MuiTypography-subtitle2': {
            fontFamily: geistFont,
            fontSize: '0.8125rem',
            color: c.textSecondary,
            letterSpacing: '-0.006em',
          },
          '& .MuiButton-root': {
            fontWeight: 500,
          },
          // K8s ContainerCard grid — 2 columns inside the half-width drawer
          '& [class*="BackstageItemCardGrid-root"]': {
            gridTemplateColumns: 'repeat(2, 1fr) !important',
            gap: '12px !important',
          },
          // FormControlLabel for YAML toggle
          '& .MuiFormControlLabel-label': {
            fontFamily: geistFont,
            fontSize: '0.8125rem',
            color: c.textSecondary,
          },
          // Scrollable content area
          '& > *': {
            minWidth: 0,
          },
        },
      },
    },

    // ---- CardActions (Logs / Terminal buttons inside ContainerCard) ----
    MuiCardActions: {
      styleOverrides: {
        root: {
          padding: '8px 16px 12px',
          gap: 6,
          '& .MuiButton-root': {
            height: 32,
            minHeight: 32,
            fontSize: '0.8125rem',
            padding: '0 10px',
          },
        },
      },
    },

    // ---- Modal (GitHub Actions log viewer) ----
    MuiModal: {
      styleOverrides: {
        root: {
          '& .MuiPaper-root': {
            backgroundColor: c.surface,
            border: `1px solid ${c.border}`,
          },
        },
      },
    },

    // ---- Alert ----
    MuiAlert: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          fontSize: '0.875rem',
          borderRadius: 8,
          border: `1px solid ${c.border}`,
        },
        standardError: {
          backgroundColor: isDark ? 'rgba(229,72,77,0.1)' : 'rgba(229,72,77,0.06)',
          borderColor: isDark ? 'rgba(229,72,77,0.3)' : 'rgba(229,72,77,0.2)',
          color: c.textPrimary,
        },
        standardWarning: {
          backgroundColor: isDark ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.06)',
          borderColor: isDark ? 'rgba(245,158,11,0.3)' : 'rgba(245,158,11,0.2)',
          color: c.textPrimary,
        },
        standardSuccess: {
          backgroundColor: isDark ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.06)',
          borderColor: isDark ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.2)',
          color: c.textPrimary,
        },
        standardInfo: {
          backgroundColor: isDark ? 'rgba(50,145,255,0.1)' : 'rgba(0,112,243,0.06)',
          borderColor: isDark ? 'rgba(50,145,255,0.3)' : 'rgba(0,112,243,0.2)',
          color: c.textPrimary,
        },
      },
    },

    // ---- Breadcrumbs ----
    MuiBreadcrumbs: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          fontSize: '0.8125rem',
          color: c.textTertiary,
        },
        separator: {
          color: c.textDisabled,
        },
        li: {
          '& a': { color: c.textTertiary, textDecoration: 'none', fontWeight: 500 },
          '& a:hover': { color: c.textPrimary },
        },
      },
    },

    // ---- Link ----
    MuiLink: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          color: c.textPrimary,
          fontWeight: 500,
          textDecoration: 'none',
          '&:hover': { color: c.blue, textDecoration: 'underline' },
        },
      },
    },

    // ---- Dialog ----
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: 12,
          boxShadow: isDark ? '0 24px 64px rgba(0,0,0,0.8)' : '0 24px 64px rgba(0,0,0,0.12)',
        },
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          fontSize: '1rem',
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: c.textPrimary,
          borderBottom: `1px solid ${c.border}`,
          padding: '16px 20px',
        },
      },
    },
    MuiDialogContent: {
      styleOverrides: {
        root: { padding: '20px', fontFamily: geistFont, color: c.textPrimary, fontSize: '0.875rem' },
      },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: { padding: '12px 20px', borderTop: `1px solid ${c.border}`, gap: 8 },
      },
    },

    // ---- Tooltip ----
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          fontFamily: geistFont,
          fontSize: '0.75rem',
          backgroundColor: isDark ? '#1a1a1a' : '#171717',
          color: isDark ? '#ededed' : '#ffffff',
          borderRadius: 6,
          border: `1px solid ${c.border}`,
          padding: '5px 10px',
        },
        arrow: { color: isDark ? '#1a1a1a' : '#171717' },
      },
    },

    // ---- Menu ----
    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundColor: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: 8,
          boxShadow: isDark ? '0 8px 32px rgba(0,0,0,0.8)' : '0 8px 32px rgba(0,0,0,0.12)',
          minWidth: 160,
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          fontSize: '0.875rem',
          color: c.textPrimary,
          padding: '8px 12px',
          minHeight: 36,
          borderRadius: 4,
          margin: '2px 4px',
          '&:hover': { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' },
          '&.Mui-selected': { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' },
        },
      },
    },
    MuiListItem: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          '&.Mui-selected': { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' },
        },
        button: {
          '&:hover': { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' },
        },
      },
    },
    MuiListItemText: {
      styleOverrides: {
        primary: { fontFamily: geistFont, fontSize: '0.875rem', color: c.textPrimary },
        secondary: { fontFamily: geistFont, fontSize: '0.8125rem', color: c.textSecondary },
      },
    },
    MuiListItemIcon: {
      styleOverrides: {
        root: { color: c.textTertiary, minWidth: 36 },
      },
    },

    // ---- Progress ----
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 99, backgroundColor: c.border, height: 2 },
        bar: { borderRadius: 99, backgroundColor: c.blue },
        colorPrimary: { backgroundColor: c.border },
        barColorPrimary: { backgroundColor: c.blue },
      },
    },
    MuiCircularProgress: {
      styleOverrides: {
        colorPrimary: { color: c.blue },
      },
    },

    // ---- Accordion ----
    MuiAccordion: {
      styleOverrides: {
        root: {
          backgroundColor: 'transparent',
          border: 'none',
          boxShadow: 'none',
          '&:before': { display: 'none' },
          '&.Mui-expanded': { margin: 0 },
        },
      },
    },
    MuiAccordionSummary: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          fontSize: '0.8125rem',
          fontWeight: 500,
          color: c.textSecondary,
          padding: '0 8px',
          minHeight: 36,
          '&.Mui-expanded': { minHeight: 36 },
        },
        content: { margin: '8px 0', '&.Mui-expanded': { margin: '8px 0' } },
        expandIconWrapper: { color: c.textTertiary },
      },
    },
    MuiAccordionDetails: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          fontSize: '0.875rem',
          color: c.textPrimary,
          padding: '4px 8px 12px',
        },
      },
    },

    // ---- Stepper ----
    MuiStepLabel: {
      styleOverrides: {
        label: {
          fontFamily: geistFont,
          fontSize: '0.875rem',
          color: c.textSecondary,
          letterSpacing: '-0.006em',
          '&.Mui-active': { color: c.textPrimary, fontWeight: 600 },
          '&.Mui-completed': { color: isDark ? COMPLETED_DARK : COMPLETED_LIGHT },
        },
        iconContainer: {
          '& .MuiStepIcon-root': {
            width: 28,
            height: 28,
          },
        },
      },
    },
    MuiStepIcon: {
      styleOverrides: {
        root: {
          color: c.border,
          '&.Mui-active': { color: c.blue },
          '&.Mui-completed': { color: isDark ? COMPLETED_DARK : COMPLETED_LIGHT },
        },
        text: { fontFamily: geistFont, fontSize: '0.75rem', fontWeight: 600 },
      },
    },
    MuiStepConnector: {
      styleOverrides: {
        root: {
          '&.Mui-active .MuiStepConnector-line': { borderColor: c.blue },
          '&.Mui-completed .MuiStepConnector-line': { borderColor: isDark ? COMPLETED_DARK : COMPLETED_LIGHT },
        },
        line: { borderColor: c.border, borderTopWidth: 2 },
        alternativeLabel: { top: 13, left: 'calc(-50% + 20px)', right: 'calc(50% + 20px)' },
      },
    },
    MuiStepper: {
      styleOverrides: {
        root: {
          backgroundColor: 'transparent',
          padding: '16px 0',
          // Override elevation variant used by Scaffolder — remove Paper bg/shadow
          backgroundImage: 'none',
          boxShadow: 'none',
          border: 'none',
        },
      },
    },

    // ---- LogViewer: fix AutoSizer height chain + enforce mono font ----
    BackstageLogViewer: {
      styleOverrides: {
        root: {
          height: '100%',
        },
        log: {
          fontFamily: geistMono,
          fontSize: '0.75rem',
        },
      },
    },

    // ---- Scaffolder Template Stepper ----
    BackstageTemplateStepper: {
      styleOverrides: {
        formWrapper: {
          padding: '24px 0',
        },
        footer: {
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: 20,
        },
        backButton: {
          marginRight: 8,
        },
      },
    },

    // ---- Scaffolder Review (StructuredMetadataTable) ----
    BackstageStructuredMetadataTable: {
      styleOverrides: {
        root: {
          '& table': {
            borderCollapse: 'separate',
            borderSpacing: 0,
          },
          '& th': {
            fontFamily: geistFont,
            fontSize: '0.8125rem',
            fontWeight: 500,
            color: c.textSecondary,
            letterSpacing: '-0.006em',
            padding: '10px 16px',
            border: 'none',
            borderBottom: `1px solid ${c.border}`,
            verticalAlign: 'top',
            width: '30%',
          },
          '& td': {
            fontFamily: geistFont,
            fontSize: '0.875rem',
            color: c.textPrimary,
            letterSpacing: '-0.006em',
            padding: '10px 16px',
            border: 'none',
            borderBottom: `1px solid ${c.border}`,
          },
          '& tr:last-child th, & tr:last-child td': {
            borderBottom: 'none',
          },
        },
      },
    },

    // ---- Avatar ----
    MuiAvatar: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          fontSize: '0.8125rem',
          fontWeight: 600,
          width: 28,
          height: 28,
          backgroundColor: c.surface,
          color: c.textSecondary,
          border: `1px solid ${c.border}`,
        },
      },
    },

    // ---- Typography ----
    MuiTypography: {
      styleOverrides: {
        h1: { fontFamily: geistFont, fontWeight: 600, letterSpacing: '-0.05em', color: c.textPrimary },
        h2: { fontFamily: geistFont, fontWeight: 600, letterSpacing: '-0.04em', color: c.textPrimary },
        h3: { fontFamily: geistFont, fontWeight: 600, letterSpacing: '-0.03em', color: c.textPrimary },
        h4: { fontFamily: geistFont, fontWeight: 600, letterSpacing: '-0.02em', color: c.textPrimary },
        h5: { fontFamily: geistFont, fontWeight: 600, letterSpacing: '-0.015em', color: c.textPrimary },
        h6: { fontFamily: geistFont, fontWeight: 600, letterSpacing: '-0.01em', color: c.textPrimary },
        body1: { fontFamily: geistFont, fontSize: '0.875rem', letterSpacing: '-0.006em', color: c.textPrimary },
        body2: { fontFamily: geistFont, fontSize: '0.875rem', letterSpacing: '-0.006em', color: c.textSecondary },
        caption: { fontFamily: geistFont, fontSize: '0.75rem', color: c.textTertiary },
        subtitle1: { fontFamily: geistFont, fontSize: '0.875rem', letterSpacing: '-0.006em' },
        subtitle2: { fontFamily: geistFont, fontSize: '0.875rem', letterSpacing: '-0.006em', color: c.textSecondary },
        overline: { fontFamily: geistFont, fontSize: '0.6875rem', fontWeight: 500, letterSpacing: '0.07em' },
      },
    },

    // ---- Backstage-specific components ----
    BackstageHeader: {
      styleOverrides: {
        header: {
          backgroundImage: 'none',
          backgroundColor: c.bg,
          boxShadow: 'none',
          borderBottom: `1px solid ${c.border}`,
          padding: '0 32px',
          height: 72,
          minHeight: 72,
          maxHeight: 72,
          overflow: 'hidden',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
        },
        title: {
          fontFamily: geistFont,
          fontSize: '1.25rem',
          fontWeight: 600,
          letterSpacing: '-0.03em',
          color: c.textPrimary,
          lineHeight: 1.3,
          margin: 0,
        },
        subtitle: {
          fontFamily: geistFont,
          fontSize: '0.8125rem',
          color: c.textTertiary,
          letterSpacing: '-0.006em',
          opacity: 1,
          margin: '2px 0 0',
          lineHeight: 1.4,
          // subtitle is rendered as component="span" with display:inline-block
          // inline-block grows with content — must switch to block so it is
          // constrained by leftItemsBox width and ellipsis kicks in
          display: 'block',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '100%',
        },
        type: {
          fontFamily: geistFont,
          fontSize: '0.6875rem',
          fontWeight: 500,
          color: c.textTertiary,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          opacity: 1,
          margin: '0 0 2px',
        },
        breadcrumb: { color: c.textTertiary, fontSize: '0.75rem', opacity: 1 },
        breadcrumbType: { color: c.textTertiary, fontSize: '0.75rem', opacity: 1 },
        breadcrumbTitle: { color: c.textTertiary, fontSize: '0.75rem', opacity: 1 },
      },
    },
    BackstageHeaderTabs: {
      styleOverrides: {
        tabsWrapper: {
          backgroundColor: c.bg,
          borderBottom: `1px solid ${c.border}`,
          paddingLeft: 24,
        },
        defaultTab: {
          fontFamily: geistFont,
          fontSize: '0.875rem',
          fontWeight: 500,
          letterSpacing: '-0.006em',
          textTransform: 'none',
          color: c.textTertiary,
          padding: '12px 20px',
          minWidth: 'unset',
          opacity: 1,
        },
        selected: { color: c.textPrimary },
        tabRoot: {
          '&:hover': {
            backgroundColor: 'transparent',
            color: c.textSecondary,
          },
        },
      },
    },
    BackstageInfoCard: {
      styleOverrides: {
        header: {
          backgroundImage: 'none',
          background: 'transparent',
          boxShadow: 'none',
          borderBottom: `1px solid ${c.border}`,
          padding: '14px 20px',
        },
        headerTitle: {
          fontFamily: geistFont,
          fontSize: '0.9375rem',
          fontWeight: 600,
          letterSpacing: '-0.02em',
          color: c.textPrimary,
        },
        headerSubheader: {
          fontFamily: geistFont,
          color: c.textSecondary,
          fontSize: '0.875rem',
        },
        // Descendant overrides — use MUI stable class names & elements
        root: {
          '& .MuiTypography-h2': {
            color: c.textTertiary,
            fontSize: '0.625rem',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            lineHeight: 1.5,
            margin: 0,
          },
          '& .MuiTypography-body2': {
            color: c.textPrimary,
            fontSize: '0.875rem',
            fontWeight: 400,
            letterSpacing: '-0.006em',
          },
          '& a': {
            color: c.textPrimary,
            textDecoration: 'none',
            fontWeight: 500,
          },
          '& a:hover': {
            color: c.blue,
            textDecoration: 'underline',
          },
        },
      },
    },
    BackstageContent: {
      styleOverrides: {
        root: {
          backgroundColor: c.bg,
          // Match previous CSS override: apply 24px to ALL Content elements
          // including those with noPadding (which only has padding:0, no !important)
          padding: '24px !important',
        },
      },
    },
    // ---- Structured Metadata Table (entity About card, Scaffolder review) ----
    BackstageMetadataTableTitleCell: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          fontSize: '0.8125rem',
          fontWeight: 500,
          color: c.textSecondary,
          letterSpacing: '-0.006em',
          padding: '8px 16px 8px 0',
          border: 'none',
          borderBottom: `1px solid ${c.border}`,
          verticalAlign: 'top',
          width: '30%',
          whiteSpace: 'nowrap',
        },
      },
    },
    BackstageMetadataTableCell: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          fontSize: '0.875rem',
          color: c.textPrimary,
          letterSpacing: '-0.006em',
          padding: '8px 0',
          border: 'none',
          borderBottom: `1px solid ${c.border}`,
          '& a': { color: c.textPrimary, fontWeight: 500, textDecoration: 'none' },
          '& a:hover': { color: c.blue, textDecoration: 'underline' },
        },
      },
    },
    BackstageMetadataTableList: {
      styleOverrides: {
        root: {
          margin: 0,
          padding: 0,
          listStyle: 'none',
        },
      },
    },
    BackstageMetadataTableListItem: {
      styleOverrides: {
        root: {
          padding: '2px 0',
          fontSize: '0.875rem',
          color: c.textPrimary,
        },
      },
    },
    BackstageStructuredMetadataTableList: {
      styleOverrides: {
        root: {
          '& table': {
            borderCollapse: 'collapse',
            width: '100%',
          },
          '& tr:last-child td, & tr:last-child th': {
            borderBottom: 'none',
          },
        },
      },
    },
    // ---- Entity page context menu ----
    PluginCatalogEntityContextMenu: {
      styleOverrides: {
        root: {
          '& .MuiIconButton-root': {
            color: c.textTertiary,
            '&:hover': { color: c.textPrimary },
          },
        },
      },
    },
    // ---- Entity Links Card ----
    EntityLinksCard: {
      styleOverrides: {
        root: {
          '& .MuiListItem-root': {
            padding: '8px 16px',
            borderBottom: `1px solid ${c.border}`,
            '&:last-child': { borderBottom: 'none' },
          },
          '& .MuiListItemIcon-root': {
            minWidth: 32,
            color: c.textTertiary,
          },
          '& .MuiListItemText-primary': {
            fontSize: '0.875rem',
            fontWeight: 500,
            color: c.textPrimary,
          },
          '& .MuiListItemText-secondary': {
            fontSize: '0.75rem',
            color: c.textTertiary,
          },
        },
      },
    },
    // ---- Entity About Card link row ----
    EntityAboutCard: {
      styleOverrides: {
        root: {
          '& .MuiIconButton-root': {
            color: c.textTertiary,
            '&:hover': { color: c.textPrimary },
          },
        },
      },
    },
    // ---- Related Entities Cards (Dependencies, Has Components, etc.) ----
    RelatedEntitiesCard: {
      styleOverrides: {
        root: {
          '& .MuiChip-root': {
            height: 22,
            fontSize: '0.6875rem',
            borderRadius: 4,
          },
        },
      },
    },

    BackstagePage: {
      styleOverrides: {
        root: {
          // Do NOT add display/flex/grid here — Page uses display:grid internally
          // for header/nav/content grid areas. Overriding it breaks layout.
          backgroundColor: c.bg,
        },
      },
    },
    BackstageSidebarPage: {
      styleOverrides: {
        root: { background: c.bg },
        content: { background: c.bg },
      },
    },
    BackstageSidebar: {
      styleOverrides: {
        drawer: {
          background: '#000000',
          border: 'none',
          borderRight: '1px solid #2e2e2e',
          borderRadius: 0,
          boxShadow: 'none',
          padding: 0,
        },
        drawerPaper: {
          background: '#000000',
          border: 'none',
          borderRight: '1px solid #2e2e2e',
          borderRadius: 0,
          boxShadow: 'none',
          padding: 0,
        },
      },
    },
    BackstageEmptyState: {
      styleOverrides: {
        root: { padding: '40px 24px' },
        title: {
          fontSize: '1.25rem',
          fontWeight: 600,
          letterSpacing: '-0.03em',
          color: c.textPrimary,
        },
        description: {
          fontSize: '0.875rem',
          color: c.textTertiary,
          letterSpacing: '-0.006em',
          maxWidth: 480,
        },
      },
    },
    BackstageTable: {
      styleOverrides: {
        root: {
          // Geist table container
          backgroundColor: c.surface,
          border: `1px solid ${c.border}`,
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: 'none',
          // material-table wraps content in nested divs with backgrounds
          '& > div': {
            backgroundColor: 'transparent !important',
            boxShadow: 'none !important',
          },
          // All nested Paper should be transparent
          '& .MuiPaper-root': {
            backgroundColor: 'transparent',
            boxShadow: 'none',
            border: 'none',
          },
          // Table body rows
          '& .MuiTableBody-root .MuiTableRow-root': {
            '&:hover': {
              backgroundColor: `${isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'} !important`,
            },
          },
          '& .MuiTableBody-root .MuiTableCell-root': {
            fontFamily: geistFont,
            fontSize: '0.875rem',
            letterSpacing: '-0.006em',
            color: c.textPrimary,
            borderBottom: `1px solid ${c.border}`,
            padding: '12px 16px',
          },
          // Pagination row
          '& .MuiTablePagination-root': {
            fontFamily: geistFont,
            color: c.textSecondary,
            borderTop: `1px solid ${c.border}`,
            fontSize: '0.8125rem',
          },
          '& .MuiTablePagination-selectIcon': { color: c.textTertiary },
          '& .MuiTablePagination-actions .MuiIconButton-root': {
            color: c.textTertiary,
            '&:hover': { color: c.textPrimary },
            '&.Mui-disabled': { color: c.textDisabled },
          },
          // Empty state
          '& .MuiTableBody-root .MuiTableRow-root td[colspan]': {
            textAlign: 'center',
            color: c.textTertiary,
            padding: '40px 16px',
            fontSize: '0.875rem',
          },
          // Links
          '& a': {
            color: c.textPrimary,
            textDecoration: 'none',
            fontWeight: 500,
          },
          '& a:hover': {
            color: c.blue,
            textDecoration: 'underline',
          },
          '& .MuiLink-root': {
            color: c.textPrimary,
            textDecoration: 'none',
            fontWeight: 500,
          },
          '& .MuiLink-root:hover': {
            color: c.blue,
            textDecoration: 'underline',
          },
          // Chip tags in table cells
          '& .MuiChip-root': {
            height: 22,
            fontSize: '0.6875rem',
            borderRadius: 4,
          },
        },
      },
    },
    // material-table toolbar (search bar, title, actions)
    BackstageTableToolbar: {
      styleOverrides: {
        root: {
          backgroundColor: 'transparent',
          padding: '12px 16px !important',
          minHeight: '48px !important',
          // Search input — replace material underline with bordered Geist input
          '& .MuiInput-root, & .MuiInputBase-root': {
            backgroundColor: isDark ? '#0a0a0a' : '#ffffff',
            borderRadius: 6,
            fontSize: '0.875rem',
            height: 36,
            border: `1px solid ${c.border}`,
            paddingLeft: 12,
            paddingRight: 8,
            '&::before, &::after': { display: 'none !important' },
            '&:hover': { borderColor: c.borderHover },
            '&.Mui-focused': { borderColor: c.blue, boxShadow: `0 0 0 3px ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,112,243,0.12)'}` },
            '& input': {
              fontFamily: geistFont,
              fontSize: '0.875rem',
              color: c.textPrimary,
              padding: '6px 0',
              '&::placeholder': { color: c.textTertiary, opacity: 1 },
            },
          },
          // Title
          '& .MuiTypography-h6': {
            fontFamily: geistFont,
            fontSize: '0.9375rem',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            color: c.textPrimary,
          },
          // Toolbar action icons (columns, export, etc.)
          '& .MuiIconButton-root': {
            color: c.textTertiary,
            borderRadius: 6,
            padding: 6,
            '&:hover': { color: c.textPrimary, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' },
          },
        },
        searchField: {
          paddingRight: '16px !important',
        },
      },
    },
    // material-table header row
    BackstageTableHeader: {
      styleOverrides: {
        header: {
          fontFamily: geistFont,
          fontSize: '0.75rem',
          fontWeight: 500,
          color: c.textSecondary,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          backgroundColor: `${isDark ? '#0a0a0a' : '#fafafa'} !important`,
          borderTop: `1px solid ${c.border} !important`,
          borderBottom: `1px solid ${c.border} !important`,
          padding: '10px 16px !important',
          '& .MuiTableSortLabel-root': {
            color: c.textSecondary,
            fontSize: '0.75rem',
            letterSpacing: '0.05em',
            '&:hover': { color: c.textPrimary },
            '&.MuiTableSortLabel-active': { color: c.textPrimary },
          },
          '& .MuiTableSortLabel-icon': {
            color: `${c.textTertiary} !important`,
            opacity: '1 !important',
          },
        },
      },
    },
    // material-table filter row
    BackstageTableFiltersContainer: {
      styleOverrides: {
        root: {
          padding: '8px 16px',
          '& .MuiButton-root': {
            fontFamily: geistFont,
            fontSize: '0.8125rem',
            textTransform: 'none',
          },
        },
      },
    },

    // ---- Toggle Buttons (used by UserSettings theme toggle) ----
    MuiToggleButton: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          fontSize: '0.8125rem',
          fontWeight: 500,
          textTransform: 'none',
          letterSpacing: '-0.006em',
          borderRadius: 6,
          border: `1px solid ${c.border}`,
          color: c.textSecondary,
          padding: '6px 14px',
          backgroundColor: 'transparent',
          '&:hover': {
            borderColor: c.borderHover,
            backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          },
          '&.Mui-selected': {
            borderColor: c.blue,
            color: c.textPrimary,
            backgroundColor: isDark ? 'rgba(50,145,255,0.1)' : 'rgba(0,112,243,0.08)',
            '&:hover': {
              backgroundColor: isDark ? 'rgba(50,145,255,0.15)' : 'rgba(0,112,243,0.12)',
            },
          },
        },
        sizeSmall: {
          padding: '4px 10px',
          fontSize: '0.75rem',
        },
      },
    },
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: {
          gap: 4,
        },
        grouped: {
          border: `1px solid ${c.border} !important`,
          borderRadius: '6px !important',
          '&:not(:first-child)': { marginLeft: 0 },
        },
      },
    },

    // ---- Switch (used in Settings, Manage Projects) ----
    MuiSwitch: {
      styleOverrides: {
        root: {
          width: 42,
          height: 24,
          padding: 0,
        },
        switchBase: {
          padding: 2,
          '&.Mui-checked': {
            transform: 'translateX(18px)',
            color: '#fff',
            '& + .MuiSwitch-track': {
              backgroundColor: c.blue,
              opacity: 1,
              border: 'none',
            },
          },
        },
        thumb: {
          width: 20,
          height: 20,
          boxShadow: 'none',
        },
        track: {
          borderRadius: 12,
          backgroundColor: c.border,
          opacity: 1,
        },
      },
    },
    BackstageItemCardGrid: {
      styleOverrides: {
        root: {
          gridTemplateColumns: 'repeat(4, 1fr)',
          gridGap: 16,
          '& > *': { height: '100%' },
          // Inside drawer (Kubernetes pod containers) — single column
          '[class*="MuiDrawer-paper"] &': {
            gridTemplateColumns: '1fr !important',
            gridAutoRows: 'auto !important',
          },
        },
      },
    },
    BackstageBottomLink: {
      styleOverrides: {
        root: {
          padding: '10px 16px',
          '& .MuiTypography-root': {
            fontSize: '0.8125rem',
            fontWeight: 500,
            letterSpacing: '-0.006em',
            color: c.textSecondary,
          },
        },
      },
    },
    BackstageHeaderIconLinkRow: {
      styleOverrides: {
        links: {
          justifyContent: 'space-evenly',
          gap: 8,
          columnGap: 8,
          rowGap: 8,
          margin: '4px 0',
        },
      },
    },
    BackstageContentHeader: {
      styleOverrides: {
        container: {
          borderBottom: `1px solid ${c.border}`,
          padding: '12px 0',
          marginBottom: 16,
          minHeight: 48,
          alignItems: 'center',
        },
        // title slot: renders as Typography variant="h4" — MUI default is 2.125rem (34px)
        // must override fontSize here or the title is enormous and overlaps other content
        title: {
          fontSize: '1rem',
          fontWeight: 600,
          letterSpacing: '-0.025em',
          color: c.textPrimary,
          lineHeight: 1.4,
          marginBottom: 0,
        },
        description: {
          fontSize: '0.875rem',
          color: c.textSecondary,
          letterSpacing: '-0.006em',
          margin: '2px 0 0',
        },
      },
    },
    BackstageHeaderLabel: {
      styleOverrides: {
        label: {
          fontFamily: geistFont,
          fontSize: '0.6875rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: c.textTertiary,
          marginBottom: 2,
          lineHeight: 1.4,
          opacity: 1,
        },
        value: {
          fontFamily: geistFont,
          fontSize: '0.875rem',
          fontWeight: 500,
          letterSpacing: '-0.006em',
          color: c.textPrimary,
          lineHeight: 1.4,
          opacity: 1,
          '& *': {
            fontSize: '0.875rem',
            fontWeight: 500,
            color: c.textPrimary,
          },
          '& a': {
            color: c.textPrimary,
            textDecoration: 'none',
          },
          '& a:hover': {
            color: c.blue,
            textDecoration: 'underline',
          },
        },
      },
    },
    BackstageInfoCardCardActionsTopRight: {
      styleOverrides: {
        root: {
          padding: '6px 6px 0 0',
          float: 'right',
        },
      },
    },

    // ---- Backstage Status indicators (used by K8s, GitHub Actions, ArgoCD) ----
    // Colors come from palette.status.* — set in both dark/light theme palettes.
    // Override the makeStyles classes here for anything the palette doesn't cover.
    BackstageStatus: {
      styleOverrides: {
        status: {
          fontFamily: geistFont,
          fontSize: '0.875rem',
          letterSpacing: '-0.006em',
        },
        ok: { fill: isDark ? '#50e3c2' : '#079669' },
        warning: { fill: isDark ? '#f5a623' : '#d97706' },
        error: { fill: '#e5484d' },
        pending: { fill: c.textTertiary },
        running: { fill: c.blue },
        aborted: { fill: c.textDisabled },
      },
    },

    // ---- GitHub Actions plugin overrides ----
    // WorkflowRunsCard uses makeStyles with hardcoded borderRadius/boxShadow
    // Override via MUI Card in its container context
    BackstageErrorPanel: {
      styleOverrides: {
        root: {
          fontFamily: geistFont,
          borderRadius: 8,
          border: `1px solid ${isDark ? 'rgba(229,72,77,0.3)' : 'rgba(229,72,77,0.2)'}`,
          backgroundColor: isDark ? 'rgba(229,72,77,0.06)' : 'rgba(229,72,77,0.03)',
          '& .MuiTypography-root': {
            fontFamily: geistFont,
          },
        },
      },
    },

    // ---- Catalog Graph plugin overrides ----
    // Plugin component class names (PluginCatalogGraph*) are hashed to jss4-NNN in production.
    // [class*="Plugin*"] selectors in overrides.css BREAK in prod — use styleOverrides here instead.
    PluginCatalogGraphCatalogGraphPage: {
      styleOverrides: {
        // The Grid container: ensure the filters column (first child) doesn't overflow
        container: {
          '& > .MuiGrid-item:first-child': {
            minWidth: 0,
            overflow: 'hidden',
          },
        },
        // The filters panel itself
        filters: {
          minWidth: 0,
          overflow: 'hidden',
          // Each filter widget row
          '& > *': {
            borderBottom: `1px solid ${c.border}`,
            paddingBottom: 4,
            minWidth: 0,
            maxWidth: '100%',
          },
          '& > *:last-child': {
            borderBottom: 'none',
          },
          // Autocomplete root has JSS maxWidth:300 but no width — anchor it
          '& .MuiAutocomplete-root': {
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
          },
          '& .MuiFormControl-root': {
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
            boxSizing: 'border-box',
          },
          '& .MuiAutocomplete-inputRoot': {
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
            flexWrap: 'wrap',
            height: 'auto',
          },
          // Section labels inside filter panel
          '& .MuiTypography-subtitle2, & .MuiFormLabel-root': {
            fontSize: '0.6875rem',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: c.textTertiary,
          },
        },
      },
    },
    // SelectedKindsFilter has a formControl class with maxWidth:300 — override to fill column
    PluginCatalogGraphSelectedKindsFilter: {
      styleOverrides: {
        formControl: {
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
        },
      },
    },
    PluginCatalogGraphSelectedRelationsFilter: {
      styleOverrides: {
        formControl: {
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
        },
      },
    },
  };
};

export const stratpointDarkTheme = createUnifiedTheme({
  ...createBaseThemeOptions({
    palette: {
      ...palettes.dark,
      primary: { main: '#3291ff', light: '#60a5fa', dark: '#0070f3', contrastText: '#fff' },
      secondary: { main: '#7928ca', light: '#8a3fd1', dark: '#6621b3', contrastText: '#fff' },
      background: { default: '#000000', paper: '#1a1a1a' },
      text: { primary: '#ededed', secondary: '#a1a1a1', disabled: '#454545' },
      divider: '#2e2e2e',
      status: {
        ok: '#50e3c2',
        warning: '#f5a623',
        error: '#e5484d',
        pending: '#878787',
        running: '#3291ff',
        aborted: '#454545',
      },
      navigation: {
        background: '#000000',
        indicator: '#ededed',
        color: '#878787',
        selectedColor: '#ededed',
        navItem: { hoverBackground: '#1a1a1a' },
        submenu: { background: '#1a1a1a' },
      },
    },
  }),
  fontFamily: geistFont,
  defaultPageTheme: 'home',
  pageTheme: {
    home: flat, documentation: flat, tool: flat,
    service: flat, website: flat, library: flat,
    other: flat, app: flat, apis: flat,
  },
  components: makeComponents(true) as any,
});

export const stratpointLightTheme = createUnifiedTheme({
  ...createBaseThemeOptions({
    palette: {
      ...palettes.light,
      primary: { main: '#0070f3', light: '#3291ff', dark: '#0060df', contrastText: '#fff' },
      secondary: { main: '#7928ca', light: '#8a3fd1', dark: '#6621b3', contrastText: '#fff' },
      background: { default: '#fafafa', paper: '#ffffff' },
      text: { primary: '#171717', secondary: '#4d4d4d', disabled: '#c9c9c9' },
      divider: '#e5e5e5',
      status: {
        ok: '#079669',
        warning: '#d97706',
        error: '#e5484d',
        pending: '#8f8f8f',
        running: '#0070f3',
        aborted: '#c9c9c9',
      },
      navigation: {
        background: '#000000',
        indicator: '#ededed',
        color: '#878787',
        selectedColor: '#ededed',
        navItem: { hoverBackground: '#1a1a1a' },
        submenu: { background: '#1a1a1a' },
      },
    },
  }),
  fontFamily: geistFont,
  defaultPageTheme: 'home',
  pageTheme: {
    home: flatLight, documentation: flatLight, tool: flatLight,
    service: flatLight, website: flatLight, library: flatLight,
    other: flatLight, app: flatLight, apis: flatLight,
  },
  components: makeComponents(false) as any,
});
