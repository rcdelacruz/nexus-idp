// Each option is a <label> around a real radio; its text is a few elements deep, so the label rule needs more depth.
/* eslint jsx-a11y/label-has-associated-control: ["error", { "depth": 6 }] */
import React, { useEffect, useState } from 'react';
import { makeStyles } from '@material-ui/core';
import { Check } from 'lucide-react';
import { appThemeApiRef, useApi } from '@backstage/core-plugin-api';
import { DEFAULT_DARK, DEFAULT_LIGHT, PALETTES, THEME_IDS, isThemeId, themeIsDark } from '@stratpoint/theme-utils';
import { AutoThemePreview, ThemePreview } from './ThemePreview';

const useStyles = makeStyles({
  group: { border: 0, margin: 0, padding: 0, minWidth: 0 },
  legend: {
    padding: 0,
    marginBottom: 10,
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--bui-fg-secondary)',
  },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 12 },
  option: { position: 'relative', display: 'block', cursor: 'pointer' },
  // The real radio sits invisibly over the whole card: clicking, arrow keys and screen readers all work natively.
  input: { position: 'absolute', inset: 0, width: '100%', height: '100%', margin: 0, opacity: 0, cursor: 'pointer', zIndex: 1 },
  card: {
    display: 'block',
    overflow: 'hidden',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--ds-background-100)',
    transition: 'border-color 0.15s ease',
    '$option:hover &': { borderColor: 'var(--border-hover)' },
    '$input:checked + &': { borderColor: 'var(--blue)', outline: '1px solid var(--blue)' },
    '$input:focus-visible + &': { outline: '2px solid var(--blue)', outlineOffset: 2 },
  },
  preview: { display: 'block', borderBottom: '1px solid var(--border)' },
  caption: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', minHeight: 20 },
  text: { display: 'block', minWidth: 0, flex: 1 },
  name: { display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: 'var(--bui-fg-primary)' },
  note: { display: 'block', fontSize: '0.75rem', color: 'var(--bui-fg-secondary)', marginTop: 2 },
  check: { flexShrink: 0, color: 'var(--blue)', visibility: 'hidden', '$input:checked + $card &': { visibility: 'visible' } },
});

type Choice = 'auto' | (typeof THEME_IDS)[number];

/** The small line under a theme's name. */
function noteFor(choice: Choice): string | undefined {
  if (choice === 'auto') return 'Follows your device';
  if (choice === DEFAULT_DARK || choice === DEFAULT_LIGHT) return 'Default';
  return undefined;
}

const GROUPS: Array<{ title: string; choices: Choice[] }> = [
  { title: 'Automatic', choices: ['auto'] },
  { title: 'Light', choices: THEME_IDS.filter(id => !themeIsDark(id)) },
  { title: 'Dark', choices: THEME_IDS.filter(id => themeIsDark(id)) },
];

/**
 * Settings → Appearance: every theme as a small picture of the portal in that theme, grouped Light / Dark.
 * "Automatic" follows the device, like Backstage's own Auto.
 */
export const ThemePicker = () => {
  const classes = useStyles();
  const appThemeApi = useApi(appThemeApiRef);
  const [saved, setSaved] = useState(() => appThemeApi.getActiveThemeId());
  useEffect(() => {
    const subscription = appThemeApi.activeThemeId$().subscribe(id => setSaved(id));
    return () => subscription.unsubscribe();
  }, [appThemeApi]);

  // Nothing saved, or a saved theme that no longer exists, both mean "follow the device".
  const selected: Choice = isThemeId(saved) ? saved : 'auto';
  const choose = (choice: Choice) => appThemeApi.setActiveThemeId(choice === 'auto' ? undefined : choice);

  return (
    <div role="presentation" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {GROUPS.map(group => (
        <fieldset key={group.title} className={classes.group}>
          <legend className={classes.legend}>{group.title}</legend>
          <div className={classes.grid}>
            {group.choices.map(choice => {
              const isAuto = choice === 'auto';
              const label = isAuto ? 'Auto' : PALETTES[choice].name;
              const note = noteFor(choice);
              return (
                <label key={choice} className={classes.option}>
                  <input
                    type="radio"
                    name="nexus-theme"
                    value={choice}
                    checked={selected === choice}
                    onChange={() => choose(choice)}
                    className={classes.input}
                  />
                  <span className={classes.card}>
                    <span className={classes.preview}>
                      {isAuto ? <AutoThemePreview light={DEFAULT_LIGHT} dark={DEFAULT_DARK} /> : <ThemePreview id={choice} />}
                    </span>
                    <span className={classes.caption}>
                      <span className={classes.text}>
                        <span className={classes.name}>{label}</span>
                        {note && <span className={classes.note}>{note}</span>}
                      </span>
                      <Check className={classes.check} size={16} strokeWidth={1.5} aria-hidden />
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
};
