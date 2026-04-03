import { useLayoutEffect } from 'react';

/**
 * Fixes catalog-graph filter panel layout via two mechanisms:
 *
 * 1. CSS injected after JSS (useLayoutEffect → last style in <head>)
 * 2. MutationObserver that directly applies inline styles with !important
 *    whenever the filter panel enters the DOM — bypasses all CSS cascade.
 *
 * The inline style approach is needed because MuiFormControl-root and
 * MuiAutocomplete-inputRoot are display:inline-flex with no explicit width.
 * They auto-size to max-content (all chips in one row), overflowing the
 * narrow filter column. Setting width:100% via inline style constrains
 * them to the column width so flex-wrap:wrap actually triggers.
 */
const css = `
  /*
   * ─── Catalog-graph filter panel ───────────────────────────────────────────
   * The Grid item (lg=2) is a flex child. Without min-width:0 it expands past
   * its flex-basis:16.667%, blowing the layout. The :has() selector targets
   * the Grid item directly; the JS MutationObserver also patches parentElement.
   */
  .MuiGrid-item:has([class*="PluginCatalogGraphCatalogGraphPage-filters"]) {
    min-width: 0 !important;
    overflow: hidden !important;
  }

  [class*="PluginCatalogGraphCatalogGraphPage-filters"] {
    min-width: 0 !important;
    overflow: hidden !important;
  }

  /*
   * Each filter widget (Box wrapper) must not overflow its parent column.
   * min-width:0 prevents a block child from inheriting max-content width.
   * overflow:hidden clips any residual overflow without hiding scrollbars.
   */
  [class*="PluginCatalogGraphCatalogGraphPage-filters"] > * {
    min-width: 0 !important;
    max-width: 100% !important;
    overflow: visible !important;
  }

  /*
   * MuiAutocomplete-root gets className={classes.formControl} which JSS
   * gives maxWidth:300 but NO explicit width. As a block div it should
   * fill its parent, but the JSS maxWidth can interact oddly with flex
   * layout. Force width:100% + min-width:0 to anchor it to the column.
   */
  [class*="PluginCatalogGraphCatalogGraphPage-filters"] .MuiAutocomplete-root {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
  }

  /* ─── FormControl: block-level to fill Autocomplete-root width ─── */
  [class*="PluginCatalogGraphCatalogGraphPage-filters"] .MuiFormControl-root {
    display: flex !important;
    flex-direction: column !important;
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    box-sizing: border-box !important;
  }

  /* ─── InputRoot: fill FormControl width, wrap chips to new lines ─── */
  [class*="PluginCatalogGraphCatalogGraphPage-filters"] .MuiAutocomplete-inputRoot {
    width: 100% !important;
    max-width: 100% !important;
    min-width: 0 !important;
    flex-wrap: wrap !important;
    height: auto !important;
    box-sizing: border-box !important;
  }

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

/** Fix Kubernetes pod card grid: gridAutoRows:1fr squishes cards in the 80%-height drawer. */
function patchKubernetesPodGrid() {
  document.querySelectorAll<HTMLElement>('[class*="BackstageItemCardGrid-root"]').forEach(el => {
    if (!el.closest('[class*="MuiDrawer-paper"]')) return; // scaffolder templates are NOT in a drawer
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
}

function findAndPatchFilterPanels() {
  // Catalog-graph filter sidebar
  document
    .querySelectorAll<Element>('[class*="PluginCatalogGraphCatalogGraphPage-filters"]')
    .forEach(patchFilterPanel);
  // Scaffolder filter drawer (portaled to body, no unique class)
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
