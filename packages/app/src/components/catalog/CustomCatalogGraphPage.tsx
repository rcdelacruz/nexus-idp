import { useEffect } from 'react';

const css = `
  /* Graph nodes */
  #dependency-graph rect { fill: var(--ds-gray-300); stroke: var(--border-hover); stroke-width: 1; }
  #dependency-graph rect.primary { fill: #0060df; stroke: #3291ff; }
  #dependency-graph rect.secondary { fill: var(--border-hover); stroke: var(--border-hover); }
  #dependency-graph text { fill: var(--fg-primary); font-size: 13px; }
  #dependency-graph text.primary { fill: #ffffff; }
  #dependency-graph path[marker-end] { stroke: var(--border-hover); }
  #dependency-graph marker path { fill: var(--border-hover); stroke: var(--border-hover); }

  /* Toggle button */
  .MuiToggleButton-root {
    font-size: 0.875rem; font-weight: 500; letter-spacing: -0.006em;
    text-transform: none; border-radius: 6px; border: none;
    box-shadow: 0 0 0 1px var(--border) inset;
    color: var(--fg-tertiary); background: transparent;
    height: 40px; padding: 0 16px;
  }
  .MuiToggleButton-root:hover { background: var(--ds-gray-alpha-200); color: var(--fg-primary); }
  .MuiToggleButton-root.Mui-selected {
    background: var(--ds-gray-200); color: var(--fg-primary);
    box-shadow: 0 0 0 1px var(--border-hover) inset;
  }

  /* Switch */
  .MuiSwitch-track { background: var(--border-hover) !important; opacity: 1 !important; }
  .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track { background: #0070f3 !important; opacity: 1 !important; }
  .MuiSwitch-switchBase.Mui-checked .MuiSwitch-thumb { background: #ffffff !important; }

  /* Autocomplete popup */
  .MuiAutocomplete-paper { background: var(--ds-gray-100); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; max-width: 320px; }
  .MuiAutocomplete-listbox { padding: 4px; overflow-x: hidden; }
  .MuiAutocomplete-option { overflow: hidden; max-width: 100%; padding: 2px 8px; }
  .MuiAutocomplete-option .MuiFormControlLabel-root { overflow: hidden; max-width: 100%; margin: 0; flex: 1; min-width: 0; }
  .MuiAutocomplete-option .MuiFormControlLabel-label {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 0.8125rem; color: var(--fg-primary);
  }
  .MuiAutocomplete-option[data-focus="true"] { background: var(--ds-gray-alpha-200); }

  /* Filter labels */
  .MuiTypography-button {
    font-size: 0.6875rem; font-weight: 600;
    letter-spacing: 0.06em; text-transform: uppercase; color: var(--fg-tertiary);
  }
`;

export const CatalogGraphStyleInjector = () => {
  useEffect(() => {
    const el = document.createElement('style');
    el.setAttribute('data-id', 'catalog-graph-overrides');
    el.textContent = css;
    document.head.appendChild(el);
    return () => { document.head.removeChild(el); };
  }, []);
  return null;
};
