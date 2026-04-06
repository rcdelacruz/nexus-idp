import { useLayoutEffect } from 'react';

/**
 * Global CSS overrides and DOM patching for stable MUI class names.
 *
 * NOTE: Do NOT add [class*="PluginXxx*"] or [class*="BackstageXxx*"] selectors here.
 * Those class names are hashed to jss4-NNN in production builds, so they BREAK.
 * Plugin/Backstage component styles belong in theme.ts styleOverrides.
 *
 * This file handles:
 * 1. CSS injected after JSS (useLayoutEffect → last style in <head>) for MUI stable classes
 * 2. Inline style patching via MutationObserver for Scaffolder filter drawer
 * 3. Kubernetes pod grid layout fix (BackstageItemCardGrid inside MuiDrawer-paper)
 */
const css = `
  /* ─── Scaffolder task page: spinner animation ─── */
  @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  /* ─── Scaffolder task page: log stream monospace font ─── */
  .geist-log-stream, .geist-log-stream * {
    font-family: "Geist Mono", "Fira Code", "Courier New", monospace !important;
    font-size: 0.8125rem !important;
    line-height: 1.6 !important;
  }

  /*
   * Catalog-graph filter panel styles were here but broke in production:
   * [class*="PluginCatalogGraph*"] selectors don't match JSS-hashed jss4-NNN classes.
   * Those styles have been moved to theme.ts (PluginCatalogGraphCatalogGraphPage.filters).
   */

  /* ─── Drawer filter panel (Scaffolder, Catalog) ─── */
  .MuiDrawer-paper .MuiFormControl-root {
    display: flex !important;
    flex-direction: column !important;
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    box-sizing: border-box !important;
  }

  .MuiDrawer-paper .MuiAutocomplete-inputRoot {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    height: auto !important;
    min-height: 36px !important;
    flex-wrap: wrap !important;
    overflow: hidden !important;
    padding: 4px 8px !important;
    align-items: center !important;
    box-sizing: border-box !important;
  }

  /* ─── All Autocomplete inputRoots: allow multi-row chip wrapping ─── */
  .MuiAutocomplete-inputRoot {
    height: auto !important;
    min-height: 36px !important;
    flex-wrap: wrap !important;
    overflow: hidden !important;
    padding: 4px 8px !important;
    align-items: center !important;
    box-sizing: border-box !important;
  }

  /* ─── Chips: don't shrink, but allow the row to wrap ─── */
  .MuiAutocomplete-tag {
    max-width: calc(100% - 8px) !important;
    overflow: hidden !important;
    flex-shrink: 0 !important;
  }

  /* ─── Autocomplete popup paper ─── */
  .MuiAutocomplete-paper {
    max-width: 280px !important;
    overflow: hidden !important;
  }

  .MuiAutocomplete-listbox {
    overflow-x: hidden !important;
    max-height: 40vh !important;
  }

  /* ─── Option rows: flex layout with overflow clipping ─── */
  .MuiAutocomplete-option {
    display: flex !important;
    align-items: center !important;
    overflow: hidden !important;
    padding: 2px 8px !important;
    min-width: 0 !important;
    max-width: 100% !important;
  }

  /* FormControlLabel (checkbox + label) inside each option */
  .MuiAutocomplete-option .MuiFormControlLabel-root {
    display: flex !important;
    align-items: center !important;
    overflow: hidden !important;
    min-width: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
    flex: 1 1 0% !important;
  }

  /* Label text needs block-level for text-overflow ellipsis to work */
  .MuiAutocomplete-option .MuiFormControlLabel-label {
    display: block !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
    min-width: 0 !important;
  }

  /* ─── End adornment buttons (clear/popup icons) ─── */
  .MuiAutocomplete-endAdornment .MuiIconButton-root {
    height: auto !important;
    min-height: unset !important;
    padding: 4px !important;
  }

`;

/** Directly patch inline styles on filter-panel Autocomplete elements. */
function patchFilterPanel(panel: Element) {
  // The Grid item parent is a flex child with flex-basis:16.667% but no min-width:0,
  // so it can expand beyond its allocation. Constraining it fixes all overflow downstream.
  const gridItem = panel.parentElement as HTMLElement | null;
  if (gridItem) {
    gridItem.style.setProperty('min-width', '0', 'important');
    gridItem.style.setProperty('overflow', 'hidden', 'important');
  }
  // Autocomplete root: anchor to column width (has JSS maxWidth:300 but no width)
  panel.querySelectorAll<HTMLElement>('.MuiAutocomplete-root').forEach(el => {
    el.style.setProperty('width', '100%', 'important');
    el.style.setProperty('max-width', '100%', 'important');
    el.style.setProperty('min-width', '0', 'important');
  });
  // FormControl: make block-level and fill column
  panel.querySelectorAll<HTMLElement>('.MuiFormControl-root').forEach(el => {
    el.style.setProperty('display', 'flex', 'important');
    el.style.setProperty('flex-direction', 'column', 'important');
    el.style.setProperty('width', '100%', 'important');
    el.style.setProperty('max-width', '100%', 'important');
    el.style.setProperty('min-width', '0', 'important');
    el.style.setProperty('box-sizing', 'border-box', 'important');
  });
  // InputRoot: fill width so flex-wrap:wrap actually constrains chips
  panel.querySelectorAll<HTMLElement>('.MuiAutocomplete-inputRoot').forEach(el => {
    el.style.setProperty('width', '100%', 'important');
    el.style.setProperty('max-width', '100%', 'important');
    el.style.setProperty('min-width', '0', 'important');
    el.style.setProperty('flex-wrap', 'wrap', 'important');
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('overflow', 'hidden', 'important');
    el.style.setProperty('box-sizing', 'border-box', 'important');
  });
}

/** Fix Kubernetes pod card grid: gridAutoRows:1fr squishes cards in the 80%-height drawer.
 *  NOTE: BackstageItemCardGrid-root is JSS-hashed in production builds — do NOT use that
 *  selector. Instead detect grid containers by computed style inside .MuiDrawer-paper. */
function patchKubernetesPodGrid() {
  document.querySelectorAll<HTMLElement>('.MuiDrawer-paper').forEach(drawer => {
    drawer.querySelectorAll<HTMLElement>('[class]').forEach(el => {
      const cs = window.getComputedStyle(el);
      if (cs.display !== 'grid' || cs.gridAutoRows !== '1fr') return;
      el.style.setProperty('grid-template-columns', '1fr', 'important');
      el.style.setProperty('grid-auto-rows', 'auto', 'important');
      el.style.setProperty('overflow-y', 'auto', 'important');
      el.style.setProperty('height', 'auto', 'important');
      const parent = el.parentElement;
      if (parent) {
        parent.style.setProperty('overflow-y', 'auto', 'important');
        parent.style.setProperty('height', 'auto', 'important');
      }
    });
  });
}


function findAndPatchFilterPanels() {
  // Catalog-graph filter sidebar styles are handled in theme.ts (PluginCatalogGraphCatalogGraphPage.filters)
  // because [class*="PluginCatalogGraph*"] selectors don't survive JSS class name hashing in production.

  // Scaffolder filter drawer (portaled to body, no unique class — MuiDrawer-paper is a stable MUI class)
  document
    .querySelectorAll<Element>('.MuiDrawer-paper')
    .forEach(patchFilterPanel);
}

export const GlobalStyleOverrides = () => {
  useLayoutEffect(() => {
    // 1. Inject CSS (last style in <head>, beats non-!important JSS)
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-id', 'backstage-global-overrides');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // 2. Apply inline styles now + after a frame (JSS may still be painting)
    patchKubernetesPodGrid();
    findAndPatchFilterPanels();
    requestAnimationFrame(() => {
      patchKubernetesPodGrid();
      findAndPatchFilterPanels();
    });

    // 3. Watch for filter panel / Kubernetes drawer to be added/changed
    const observer = new MutationObserver(() => {
      patchKubernetesPodGrid();
      findAndPatchFilterPanels();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

    return () => {
      document.head.removeChild(styleEl);
      observer.disconnect();
    };
  }, []);
  return null;
};
