import { makeStyles } from '@material-ui/core';

/**
 * Styles of the Trainees page. The list is the portal's own table (the one User Management uses) and the states are its badges, so this
 * file only holds what those do not give: the cells' small parts and the side panel. Colours come only from the app's theme variables
 * (`--fg-primary`, `--border`, `--surface`, ...), never from hex values, so every theme reads well.
 */
export const usePageStyles = makeStyles(theme => ({
  // What is loading and Refresh, at the right of the Active / Archive tabs (where User Management puts its Refresh).
  live: { display: 'flex', alignItems: 'center', gap: theme.spacing(1.25), fontSize: '0.75rem', color: 'var(--fg-secondary)' },
  meter: { width: 96, height: 4, borderRadius: 4, background: 'var(--ds-gray-300)', overflow: 'hidden' },
  meterFill: { display: 'block', height: '100%', background: theme.palette.primary.main, transition: 'width .2s linear' },
  notice: { marginBottom: theme.spacing(2) },

  // Table cells.
  sub: { display: 'block', fontSize: '0.75rem', color: 'var(--fg-secondary)', lineHeight: 1.35 },
  trunc: { display: 'block', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  none: { color: 'var(--fg-secondary)' },
  progress: { display: 'flex', alignItems: 'center', gap: 8, fontVariantNumeric: 'tabular-nums' },
  progressBar: { width: 56, height: 4, borderRadius: 4, background: 'var(--ds-gray-300)', overflow: 'hidden' },
  progressFill: { display: 'block', height: '100%', background: theme.palette.primary.main },
  spark: { display: 'flex', gap: 2, alignItems: 'flex-end', height: 22, minWidth: 14 * 6 },
  sparkBar: { width: 4, borderRadius: 1, background: theme.palette.primary.main },
  sparkZero: { width: 4, height: 2, borderRadius: 1, background: 'var(--ds-gray-300)' },
  // A grey bar of the size of the value that will replace it, so nothing moves when the data arrives.
  skeleton: {
    display: 'inline-block',
    height: 10,
    borderRadius: 4,
    verticalAlign: 'middle',
    background: 'linear-gradient(90deg, var(--ds-gray-200) 25%, var(--ds-gray-300) 50%, var(--ds-gray-200) 75%)',
    backgroundSize: '200% 100%',
    animation: '$shimmer 1.2s linear infinite',
    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
  },
  '@keyframes shimmer': { to: { backgroundPosition: '-200% 0' } },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: theme.spacing(1), padding: theme.spacing(6, 2), color: 'var(--fg-secondary)', textAlign: 'center' },

  // The side panel. The portal's Drawer already pads its paper, so nothing here adds side padding of its own.
  panel: { width: 'min(560px, 100vw)' },
  panelHead: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: theme.spacing(1), marginBottom: theme.spacing(1.5) },
  panelTitle: { minWidth: 0 },
  badges: { display: 'flex', flexWrap: 'wrap', gap: theme.spacing(0.75), marginBottom: theme.spacing(2) },
  // Real buttons, all of them outlined or filled with their icon and their words: nothing in the panel is a bare text button.
  actions: { display: 'flex', flexWrap: 'wrap', gap: theme.spacing(1), marginBottom: theme.spacing(2) },
  tabs: { marginBottom: theme.spacing(2) },
  section: { border: '1px solid var(--border)', borderRadius: 8, padding: theme.spacing(2), marginBottom: theme.spacing(2) },
  sectionTitle: { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fg-secondary)', margin: theme.spacing(0, 0, 1.5) },
  kv: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: theme.spacing(2), padding: theme.spacing(0.75, 0), fontSize: '0.8125rem', borderBottom: '1px solid var(--ds-gray-alpha-300)', '&:last-child': { borderBottom: 0 } },
  kvKey: { color: 'var(--fg-secondary)' },
  kvValue: { fontVariantNumeric: 'tabular-nums', textAlign: 'right', overflowWrap: 'anywhere' },
  bigBars: { display: 'flex', gap: 4, alignItems: 'flex-end', height: 56 },
  bigBar: { flex: 1, borderRadius: 2, background: theme.palette.primary.main, minHeight: 2 },
  bigBarZero: { flex: 1, height: 2, borderRadius: 2, background: 'var(--ds-gray-300)' },
  axis: { display: 'flex', justifyContent: 'space-between', fontSize: '0.6875rem', color: 'var(--fg-secondary)', marginTop: 4 },
  pills: { display: 'flex', flexWrap: 'wrap', gap: theme.spacing(0.5) },
  links: { display: 'flex', flexWrap: 'wrap', gap: theme.spacing(1) },
  // One check, one card: what it is and its latest result on the left, its buttons on the right.
  check: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: theme.spacing(1.5), border: '1px solid var(--border)', borderRadius: 8, padding: theme.spacing(1.5, 2), marginBottom: theme.spacing(1) },
  checkText: { minWidth: 0, display: 'grid', gap: 2 },
  checkButtons: { display: 'flex', gap: theme.spacing(1) },
  history: { display: 'flex', flexWrap: 'wrap', gap: theme.spacing(1), alignItems: 'center', padding: theme.spacing(1, 0), borderBottom: '1px solid var(--ds-gray-alpha-300)', fontSize: '0.8125rem', '&:last-child': { borderBottom: 0 } },
  // marginTop: whatever a tab ends with (a row of link buttons, a card) gets the same gap above this box.
  danger: { marginTop: theme.spacing(2), border: '1px solid var(--border)', borderRadius: 8, padding: theme.spacing(2), display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: theme.spacing(1.5) },
}));
