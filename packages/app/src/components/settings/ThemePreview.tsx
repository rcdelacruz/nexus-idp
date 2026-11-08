import React from 'react';
import { PALETTES } from '@stratpoint/theme-utils';
import type { ThemeId } from '@stratpoint/theme-utils';

/**
 * A small picture of the portal in one theme: the dark sidebar, a page with a title, buttons and a card.
 * Every colour comes from that theme's own palette, so the picture can never drift from the real theme.
 */
export const ThemePreview = ({ id }: { id: ThemeId }) => {
  const p = PALETTES[id];
  const sb = PALETTES[p.sidebar]; // the sidebar is always a dark surface
  const bar = (width: string, height: number, background: string) => (
    <div style={{ width, height, borderRadius: height / 2, background, flexShrink: 0 }} />
  );
  return (
    <div
      aria-hidden
      data-theme-preview={id}
      style={{ display: 'flex', aspectRatio: '16 / 10', background: p.bg, overflow: 'hidden', width: '100%' }}
    >
      <div style={{ width: '24%', background: sb.bg, borderRight: `1px solid ${sb.border}`, padding: '9% 6%', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {bar('60%', 4, sb.text)}
        <div style={{ height: 6 }} />
        <div style={{ background: sb.hoverBg, borderRadius: 3, padding: '3px 4px' }}>{bar('80%', 3, sb.text)}</div>
        <div style={{ padding: '0 4px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {bar('70%', 3, sb.textMuted)}
          {bar('85%', 3, sb.textMuted)}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: '8% 7%', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {bar('45%', 5, p.text)}
        {bar('70%', 3, p.textMuted)}
        <div style={{ display: 'flex', gap: 5, margin: '3px 0' }}>
          <div style={{ width: '28%', height: 10, borderRadius: 3, background: p.text }} />
          <div style={{ width: '28%', height: 10, borderRadius: 3, boxSizing: 'border-box', border: `1px solid ${p.borderHover}` }} />
          <div style={{ width: '16%', height: 10, borderRadius: 5, background: p.blue }} />
        </div>
        <div style={{ flex: 1, minHeight: 0, background: p.surface, border: `1px solid ${p.border}`, borderRadius: 4, padding: '6%', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {bar('62%', 3, p.text)}
          {bar('86%', 3, p.textSecondary)}
          {bar('34%', 3, p.blue)}
        </div>
      </div>
    </div>
  );
};

/** "Auto": the default light theme on one half, the default dark theme on the other. */
export const AutoThemePreview = ({ light, dark }: { light: ThemeId; dark: ThemeId }) => (
  <div aria-hidden data-theme-preview="auto" style={{ position: 'relative', width: '100%' }}>
    <ThemePreview id={light} />
    <div style={{ position: 'absolute', inset: 0, clipPath: 'polygon(55% 0, 100% 0, 100% 100%, 45% 100%)' }}>
      <ThemePreview id={dark} />
    </div>
  </div>
);
