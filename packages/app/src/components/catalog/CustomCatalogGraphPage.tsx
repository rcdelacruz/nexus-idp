import { useEffect } from 'react';

const css = `
  /* Graph nodes */
  #dependency-graph rect { fill: #292929; stroke: #454545; stroke-width: 1; }
  #dependency-graph rect.primary { fill: #0060df; stroke: #3291ff; }
  #dependency-graph rect.secondary { fill: #454545; stroke: #454545; }
  #dependency-graph text { fill: #ededed; font-size: 13px; }
  #dependency-graph text.primary { fill: #ffffff; }
  #dependency-graph path[marker-end] { stroke: #454545; }
  #dependency-graph marker path { fill: #454545; stroke: #454545; }

  /* Toggle button */
  .MuiToggleButton-root {
    font-size: 0.875rem; font-weight: 500; letter-spacing: -0.006em;
    text-transform: none; border-radius: 6px; border: none;
    box-shadow: 0 0 0 1px #2e2e2e inset;
    color: #878787; background: transparent;
    height: 40px; padding: 0 16px;
  }
  .MuiToggleButton-root:hover { background: #ffffff17; color: #ededed; }
  .MuiToggleButton-root.Mui-selected {
    background: #1f1f1f; color: #ededed;
    box-shadow: 0 0 0 1px #454545 inset;
  }

  /* Switch */
  .MuiSwitch-track { background: #454545 !important; opacity: 1 !important; }
  .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track { background: #0070f3 !important; opacity: 1 !important; }
  .MuiSwitch-switchBase.Mui-checked .MuiSwitch-thumb { background: #ffffff !important; }

  /* Autocomplete popup */
  .MuiAutocomplete-paper { background: #1a1a1a; border: 1px solid #2e2e2e; border-radius: 8px; overflow: hidden; max-width: 320px; }
  .MuiAutocomplete-listbox { padding: 4px; overflow-x: hidden; }
  .MuiAutocomplete-option { overflow: hidden; max-width: 100%; padding: 2px 8px; }
  .MuiAutocomplete-option .MuiFormControlLabel-root { overflow: hidden; max-width: 100%; margin: 0; flex: 1; min-width: 0; }
  .MuiAutocomplete-option .MuiFormControlLabel-label {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 0.8125rem; color: #ededed;
  }
  .MuiAutocomplete-option[data-focus="true"] { background: #ffffff17; }

  /* Filter labels */
  .MuiTypography-button {
    font-size: 0.6875rem; font-weight: 600;
    letter-spacing: 0.06em; text-transform: uppercase; color: #878787;
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
