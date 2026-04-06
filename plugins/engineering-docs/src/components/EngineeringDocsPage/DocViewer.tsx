import React, { useEffect, useRef, useState } from 'react';
import * as ReactDOMClient from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { makeStyles } from '@material-ui/core';
import { useColors, getColors, DesignTokens } from '@stratpoint/theme-utils';
import { atomOneDark, atomOneLight } from 'react-syntax-highlighter/dist/cjs/styles/hljs';
import { Copy, Check, RefreshCw } from 'lucide-react';

import { slugify } from './DocTOC';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const SyntaxHighlighter: any = require('react-syntax-highlighter').default ?? require('react-syntax-highlighter');

// ─── Mermaid ────────────────────────────────────────────────────────────────

// Track the last theme Mermaid was initialized with — only re-initialize on theme change,
// not on every render. Re-initializing every render destabilizes Mermaid v11's internal state.
let _mermaidTheme: string | null = null;

const MermaidDiagram = ({ code, dark }: { code: string; dark: boolean }) => {
  const c = useColors();
  const ref = useRef<HTMLDivElement>(null);
  const [zoomed, setZoomed] = useState(false);
  const [svg, setSvg] = useState('');

  useEffect(() => {
    let cancelled = false;
    import('mermaid').then(({ default: mermaid }) => {
      if (cancelled) return;
      const theme = dark ? 'dark' : 'light';
      if (_mermaidTheme !== theme) {
        _mermaidTheme = theme;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          flowchart: { useMaxWidth: true, htmlLabels: true },
          sequence: { useMaxWidth: true },
          gantt: { useMaxWidth: true },
          themeVariables: dark ? {
            background: c.surfaceSubtle,
            mainBkg: c.hoverBg,
            nodeBorder: '#333333',
            lineColor: '#666666',
            primaryColor: c.hoverBg,
            primaryTextColor: c.text,
            primaryBorderColor: '#333333',
            secondaryColor: '#141414',
            tertiaryColor: '#0d0d0d',
            clusterBkg: c.surface,
            titleColor: c.text,
            edgeLabelBackground: c.inputBg,
            fontFamily: '"Geist", "Helvetica Neue", Arial, sans-serif',
            fontSize: '14px',
          } : {
            background: c.surfaceSubtle,
            mainBkg: c.avatarBg,
            nodeBorder: '#e0e0e0',
            lineColor: '#555555',
            primaryColor: c.avatarBg,
            primaryTextColor: c.text,
            primaryBorderColor: '#e0e0e0',
            secondaryColor: c.bg,
            tertiaryColor: '#f9fafb',
            clusterBkg: c.bg,
            titleColor: c.text,
            edgeLabelBackground: c.surface,
            fontFamily: '"Geist", "Helvetica Neue", Arial, sans-serif',
            fontSize: '14px',
          },
        });
      }
      const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      mermaid.render(id, code.trim()).then(({ svg: rendered }) => {
        if (cancelled) return;
        // Make SVG responsive and prevent text/content overflow clipping
        // Mermaid with useMaxWidth:true already outputs width="100%" and style="max-width:Xpx;"
        // Only fix: merge overflow:visible into the existing style so node content isn't clipped.
        const fixed = rendered
          .replace(/(<svg[^>]*)\s+style="([^"]*)"/, '$1 style="$2;overflow:visible;"');
        setSvg(fixed);
        if (ref.current) ref.current.innerHTML = fixed;
      }).catch(() => {
        if (!cancelled && ref.current) ref.current.textContent = code;
      });
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, dark]);

  return (
    <>
      <div
        ref={ref}
        role={svg ? 'button' : 'img'}
        aria-label={svg ? 'Expand diagram' : undefined}
        onClick={() => svg && setZoomed(true)}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && svg) setZoomed(true); }}
        tabIndex={svg ? 0 : undefined}
        style={{ overflowX: 'auto', padding: '16px 0', cursor: svg ? 'zoom-in' : 'default' }}
      />
      {zoomed && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => setZoomed(false)}
          onKeyDown={e => { if (e.key === 'Escape') setZoomed(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.85)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out',
            padding: 32,
          }}
        >
          <div
            role="presentation"
            onClick={e => e.stopPropagation()}
            style={{ width: '85vw', maxHeight: '85vh', overflow: 'auto', background: dark ? '#111' : '#fff', borderRadius: 12, padding: 32 }}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{
              __html: svg
                .replace(/(<svg[^>]*)\s+style="([^"]*)"/, '$1 style="$2;width:100%;height:auto;overflow:visible;"'),
            }}
          />
        </div>
      )}
    </>
  );
};

// ─── Code block ─────────────────────────────────────────────────────────────

export const CodeBlock = ({ code, language, dark, title }: { code: string; language: string; dark: boolean; title?: string }) => {
  const c = getColors(dark);
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard.writeText(code).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  });

  if (language === 'mermaid') return <MermaidDiagram code={code} dark={dark} />;

  const headerBg = dark ? c.surface : c.avatarBg;
  const borderColor = dark ? c.borderSubtle : c.border;

  return (
    <div style={{ borderRadius: 8, border: `1px solid ${borderColor}`, marginBottom: 20, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 14px', background: headerBg, borderBottom: `1px solid ${borderColor}` }}>
        <span style={{ fontSize: '0.75rem', fontFamily: '"Geist Mono", monospace', color: c.textMuted, letterSpacing: '0.02em' }}>
          {title || language || 'text'}
        </span>
        <button
          onClick={copy}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: c.textMuted, fontFamily: '"Geist", sans-serif', padding: '2px 6px', borderRadius: 4 }}
        >
          {copied ? <><Check size={12} strokeWidth={1.5} /> Copied</> : <><Copy size={12} strokeWidth={1.5} /> Copy</>}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={dark ? atomOneDark : atomOneLight}
        customStyle={{ margin: 0, borderRadius: 0, fontSize: '0.8125rem', fontFamily: '"Geist Mono", "Fira Code", monospace', padding: '14px 16px', background: c.surfaceSubtle }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
};

// ─── Fallback: react-markdown renderer (when html is empty) ─────────────────

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string') return node;
  if (React.isValidElement(node)) return React.Children.toArray((node.props as any).children).map(extractText).join('');
  return '';
}

const CALLOUT_STYLES: Record<string, { color: string; bg: string; border: string; icon: string; label: string }> = {
  NOTE:      { color: '#3b82f6', bg: 'rgba(59,130,246,0.07)',  border: 'rgba(59,130,246,0.25)',  icon: 'ℹ️',  label: 'Note' },
  INFO:      { color: '#3b82f6', bg: 'rgba(59,130,246,0.07)',  border: 'rgba(59,130,246,0.25)',  icon: 'ℹ️',  label: 'Info' },
  TIP:       { color: '#10b981', bg: 'rgba(16,185,129,0.07)',  border: 'rgba(16,185,129,0.25)',  icon: '💡', label: 'Tip' },
  WARNING:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)',  border: 'rgba(245,158,11,0.25)',  icon: '⚠️', label: 'Warning' },
  IMPORTANT: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.07)', border: 'rgba(139,92,246,0.25)', icon: '📌', label: 'Important' },
  CAUTION:   { color: '#ef4444', bg: 'rgba(239,68,68,0.07)',   border: 'rgba(239,68,68,0.25)',   icon: '🔴', label: 'Caution' },
  ERROR:     { color: '#ef4444', bg: 'rgba(239,68,68,0.07)',   border: 'rgba(239,68,68,0.25)',   icon: '🚨', label: 'Error' },
  DEFAULT:   { color: '#6b7280', bg: 'rgba(107,114,128,0.07)', border: 'rgba(107,114,128,0.25)', icon: 'ℹ️', label: 'Note' },
};

const CalloutBlock = ({ children }: { children: React.ReactNode }) => {
  const childArray = React.Children.toArray(children);
  const firstText = React.isValidElement(childArray[0]) ? extractText(childArray[0]).trim() : '';
  const m = firstText.match(/^\[!(NOTE|INFO|TIP|WARNING|IMPORTANT|CAUTION|ERROR|DEFAULT)\]$/i);
  if (!m) return <blockquote style={{ margin: '0 0 20px', padding: '12px 16px', borderLeft: '3px solid #e5e5e5', color: '#6b7280', fontStyle: 'italic' }}>{children}</blockquote>;
  const s = CALLOUT_STYLES[m[1].toUpperCase()];
  return (
    <div style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: 8, padding: '12px 16px', marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, fontSize: '0.875rem', fontWeight: 600, color: s.color, fontFamily: '"Geist", sans-serif' }}>
        <span>{s.icon}</span><span>{s.label}</span>
      </div>
      <div style={{ fontSize: '0.9375rem', lineHeight: 1.65 }}>{childArray.slice(1)}</div>
    </div>
  );
};

const makeHeading = (level: 1 | 2 | 3 | 4) => ({ children, ...props }: any) =>
  React.createElement(`h${level}`, { id: slugify(extractText(children)), ...props }, children);

function preprocessCallouts(content: string): string {
  return content.replace(/^(> \[!(?:NOTE|INFO|TIP|WARNING|IMPORTANT|CAUTION|ERROR|DEFAULT)\])\n(> )/gm, '$1\n>\n$2');
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles<{}, DesignTokens>(() => {
  // Nextra component colors
  const calloutNote = { color: '#3b82f6', bg: 'rgba(59,130,246,0.07)', border: 'rgba(59,130,246,0.25)' };
  const calloutTip = { color: '#10b981', bg: 'rgba(16,185,129,0.07)', border: 'rgba(16,185,129,0.25)' };
  const calloutWarn = { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)', border: 'rgba(245,158,11,0.25)' };
  const calloutErr = { color: '#ef4444', bg: 'rgba(239,68,68,0.07)', border: 'rgba(239,68,68,0.25)' };
  const calloutImp = { color: '#8b5cf6', bg: 'rgba(139,92,246,0.07)', border: 'rgba(139,92,246,0.25)' };
  const calloutDef = { color: '#6b7280', bg: 'rgba(107,114,128,0.07)', border: 'rgba(107,114,128,0.25)' };

  return {
    root: {
      flex: 1,
      padding: '40px 48px',
      overflowY: 'auto',
      maxWidth: 860,
      fontFamily: '"Geist", "Inter", "Helvetica Neue", Arial, sans-serif',
      color: ({ text }: DesignTokens) => text,
      lineHeight: 1.7,

      '& h1': { fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.2, marginTop: 0, marginBottom: 24, color: ({ text }: DesignTokens) => text, paddingBottom: 16, borderBottom: ({ border }: DesignTokens) => `1px solid ${border}`, scrollMarginTop: 16 },
      '& h2': { fontSize: '1.375rem', fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.3, marginTop: 48, marginBottom: 16, paddingBottom: 10, borderBottom: ({ border }: DesignTokens) => `1px solid ${border}`, color: ({ text }: DesignTokens) => text, scrollMarginTop: 16 },
      '& h3': { fontSize: '1.125rem', fontWeight: 600, letterSpacing: '-0.015em', marginTop: 32, marginBottom: 10, color: ({ text }: DesignTokens) => text, scrollMarginTop: 16 },
      '& h4': { fontSize: '1rem', fontWeight: 600, letterSpacing: '-0.01em', marginTop: 24, marginBottom: 8, color: ({ text }: DesignTokens) => text, scrollMarginTop: 16 },
      '& p': { fontSize: '0.9375rem', lineHeight: 1.75, letterSpacing: '-0.003em', marginBottom: 20, color: ({ textSecondary }: DesignTokens) => textSecondary },
      '& ul, & ol': { paddingLeft: 28, marginBottom: 20 },
      '& li': { fontSize: '0.9375rem', lineHeight: 1.75, letterSpacing: '-0.003em', marginBottom: 6, color: ({ textSecondary }: DesignTokens) => textSecondary },
      '& li > ul, & li > ol': { marginTop: 6, marginBottom: 0 },
      '& strong': { fontWeight: 600, color: ({ text }: DesignTokens) => text },
      '& em': { fontStyle: 'italic' },
      '& :not(pre) > code': { fontFamily: '"Geist Mono", "Fira Code", monospace', fontSize: '0.8125rem', background: ({ inputBg }: DesignTokens) => inputBg, border: ({ border }: DesignTokens) => `1px solid ${border}`, padding: '1px 6px', borderRadius: 4, color: ({ isDark }: DesignTokens) => isDark ? '#e2b96b' : '#d97706' },
      '& pre': { margin: '0 0 4px', background: 'transparent !important' },
      // Fix: theme's `* { fontFamily: geist !important }` overrides spans inside pre/code.
      // Use higher-specificity rule to restore monospace inside code elements.
      '& pre *, & code *': { fontFamily: '"Geist Mono", "Fira Code", "Courier New", monospace !important' },
      // Mermaid foreignObject fix: DocViewer's `& p` rule applies 0.9375rem (15px) to all p elements
      // including those inside mermaid's <foreignObject> nodes, but mermaid sized them for 14px.
      // Reset font metrics inside SVG p elements and allow overflow so text isn't clipped.
      '& foreignObject': { overflow: 'visible' },
      '& svg p': { fontSize: '14px !important', lineHeight: '1.5 !important', letterSpacing: 'normal !important', marginBottom: '0 !important', color: 'inherit !important' },
      '& table': { width: '100%', borderCollapse: 'collapse', marginBottom: 28, fontSize: '0.875rem', display: 'block', overflowX: 'auto' as const },
      '& th': { border: ({ border }: DesignTokens) => `1px solid ${border}`, padding: '10px 16px', background: ({ surface }: DesignTokens) => surface, fontWeight: 600, letterSpacing: '-0.006em', textAlign: 'left' as const, color: ({ text }: DesignTokens) => text, whiteSpace: 'nowrap' as const },
      '& td': { border: ({ border }: DesignTokens) => `1px solid ${border}`, padding: '10px 16px', color: ({ textSecondary }: DesignTokens) => textSecondary, verticalAlign: 'top' as const },
      '& tr:nth-child(even) td': { background: ({ isDark }: DesignTokens) => isDark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.01)' },
      '& a': { color: ({ isDark }: DesignTokens) => isDark ? '#60a5fa' : '#2563eb', textDecoration: 'underline', textDecorationColor: ({ isDark }: DesignTokens) => isDark ? 'rgba(96,165,250,0.3)' : 'rgba(37,99,235,0.3)', '&:hover': { textDecorationColor: ({ isDark }: DesignTokens) => isDark ? '#60a5fa' : '#2563eb' } },
      '& hr': { border: 'none', borderTop: ({ border }: DesignTokens) => `1px solid ${border}`, margin: '40px 0' },
      '& img': { maxWidth: '100%', borderRadius: 8, display: 'block', margin: '16px 0' },
      '& blockquote': { margin: '0 0 20px', padding: '12px 16px', borderLeft: ({ border }: DesignTokens) => `3px solid ${border}`, color: ({ textSecondary }: DesignTokens) => textSecondary, fontStyle: 'italic' },
      // Definition lists (MkDocs)
      '& dl': { marginBottom: 20 },
      '& dt': { fontWeight: 600, color: ({ text }: DesignTokens) => text, fontSize: '0.9375rem', marginTop: 12, marginBottom: 2 },
      '& dd': { marginLeft: 24, color: ({ textSecondary }: DesignTokens) => textSecondary, fontSize: '0.9375rem', lineHeight: 1.75, marginBottom: 4 },

      // ── Nextra: Callout ──────────────────────────────────────────────────
      '& .nh-callout': { borderRadius: 8, padding: '12px 16px', marginBottom: 20 },
      '& .nh-callout-title': { display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.875rem', fontWeight: 600, marginBottom: 6, fontFamily: '"Geist", sans-serif' },
      '& .nh-callout-body': { fontSize: '0.9375rem', lineHeight: 1.65, fontFamily: '"Geist", sans-serif', '& p': { marginBottom: 0 } },
      '& .nh-callout-note, & .nh-callout-info':  { background: calloutNote.bg,  border: `1px solid ${calloutNote.border}`,  '& .nh-callout-title': { color: calloutNote.color } },
      '& .nh-callout-tip':                        { background: calloutTip.bg,   border: `1px solid ${calloutTip.border}`,   '& .nh-callout-title': { color: calloutTip.color } },
      '& .nh-callout-warning':                    { background: calloutWarn.bg,  border: `1px solid ${calloutWarn.border}`,  '& .nh-callout-title': { color: calloutWarn.color } },
      '& .nh-callout-caution, & .nh-callout-error': { background: calloutErr.bg, border: `1px solid ${calloutErr.border}`,  '& .nh-callout-title': { color: calloutErr.color } },
      '& .nh-callout-important':                  { background: calloutImp.bg,   border: `1px solid ${calloutImp.border}`,  '& .nh-callout-title': { color: calloutImp.color } },
      '& .nh-callout-default':                    { background: calloutDef.bg,   border: `1px solid ${calloutDef.border}`,  '& .nh-callout-title': { color: calloutDef.color } },

      // ── Nextra: Steps ────────────────────────────────────────────────────
      '& .nh-steps': { marginBottom: 24 },
      '& .nh-step': { display: 'flex', gap: 16, marginBottom: 4 },
      '& .nh-step-indicator': { display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 },
      '& .nh-step-number': { width: 28, height: 28, borderRadius: '50%', background: ({ text }: DesignTokens) => text, color: ({ isDark }: DesignTokens) => isDark ? '#171717' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, fontFamily: '"Geist", sans-serif' },
      '& .nh-step-line': { width: 1, flex: 1, minHeight: 16, background: ({ border }: DesignTokens) => border, marginTop: 4 },
      '& .nh-step-content': { flex: 1, paddingBottom: 16, '& h3': { marginTop: 4 } },

      // ── Nextra: FileTree ─────────────────────────────────────────────────
      '& .nh-filetree': { border: ({ border }: DesignTokens) => `1px solid ${border}`, borderRadius: 8, padding: '12px 16px', marginBottom: 20, background: ({ surfaceSubtle }: DesignTokens) => surfaceSubtle },
      '& .nh-filetree-folder-name': { fontFamily: '"Geist Mono", monospace', fontSize: '0.875rem', padding: '2px 0', color: ({ text }: DesignTokens) => text, cursor: 'default' },
      '& .nh-filetree-children': { paddingLeft: 20, borderLeft: ({ border }: DesignTokens) => `1px solid ${border}`, marginLeft: 7, marginTop: 4 },
      '& .nh-filetree-file': { fontFamily: '"Geist Mono", monospace', fontSize: '0.875rem', padding: '2px 0', color: ({ textSecondary }: DesignTokens) => textSecondary },

      // ── Nextra: Tabs (static fallback; interactive version replaces via useEffect) ──
      '& .nh-tabs': { marginBottom: 20 },
      '& .nh-tab': { marginBottom: 16 },
      '& .nh-tab-label': { fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: ({ textSecondary }: DesignTokens) => textSecondary, marginBottom: 8, opacity: 0.6 },
      '& .nh-tab-content': {},
      '& .nh-interactive-tabs': { marginBottom: 20 },

      // ── Nextra: Cards ─────────────────────────────────────────────────────
      '& .nh-cards': { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 20 },
      '& .nh-card': { border: ({ border }: DesignTokens) => `1px solid ${border}`, borderRadius: 10, padding: '16px 18px', minWidth: 0, overflow: 'hidden' },
      '& .nh-card-title': { fontWeight: 600, fontSize: '0.9375rem', color: ({ text }: DesignTokens) => text, marginBottom: 6, fontFamily: '"Geist", sans-serif', wordBreak: 'break-word', overflowWrap: 'break-word' },
      '& .nh-card-body': { fontSize: '0.875rem', color: ({ textSecondary }: DesignTokens) => textSecondary, lineHeight: 1.6, wordBreak: 'break-word', overflowWrap: 'break-word' },

      // ── MkDocs custom classes (kafka training repo) ────────────────────────
      '& .card-grid': { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, margin: '16px 0' },
      // minWidth:0 + overflow:hidden required on grid children — prevents expansion and clips overflow
      '& .success-box': { minWidth: 0, overflow: 'hidden', background: 'rgba(0,204,102,0.08)', borderLeft: '4px solid #00cc66', padding: '12px 16px', borderRadius: 4, marginBottom: 0, overflowWrap: 'break-word', wordBreak: 'break-all' },
      '& .kafka-container': { minWidth: 0, overflow: 'hidden', background: ({ isDark }: DesignTokens) => isDark ? 'rgba(255,102,0,0.08)' : 'rgba(255,102,0,0.05)', borderLeft: '4px solid #ff6600', padding: '12px 16px', borderRadius: 4, marginBottom: 0, overflowWrap: 'break-word', wordBreak: 'break-all' },
      '& .info-box': { minWidth: 0, overflow: 'hidden', background: 'rgba(0,102,204,0.08)', borderLeft: '4px solid #0066cc', padding: '12px 16px', borderRadius: 4, marginBottom: 0, overflowWrap: 'break-word', wordBreak: 'break-all' },
      '& .container-section': { minWidth: 0, overflow: 'hidden', background: 'rgba(36,150,237,0.06)', borderLeft: '4px solid #2496ed', padding: '12px 16px', borderRadius: 4, marginBottom: 0, overflowWrap: 'break-word', wordBreak: 'break-all' },
      // Reset p margin inside cards so it doesn't add extra space
      '& .success-box p, & .kafka-container p, & .info-box p, & .container-section p': { marginBottom: 0 },
    },
  };
});

// ─── DocViewer ───────────────────────────────────────────────────────────────

interface DocViewerProps {
  content: string;     // raw markdown (fallback)
  html?: string;       // pre-rendered HTML from backend (preferred)
  currentPath?: string; // selected nav path (e.g. "getting-started/installation")
  onNavigate?: (path: string) => void; // called when an internal doc link is clicked
  onRefresh?: () => void; // called when user clicks refresh
  refreshing?: boolean;   // true while refresh is in flight
}

// Resolve a relative doc link href to a nav path (no extension, relative to currentPath's dir)
function resolveDocPath(href: string, currentPath: string): string {
  // Strip anchor fragment before resolving
  const [pathPart] = href.split('#');
  // Strip .md / .mdx extension
  const stripped = pathPart.replace(/\.(md|mdx)$/i, '');
  if (stripped.startsWith('/')) return stripped.replace(/^\//, '');
  const currentDir = currentPath.includes('/')
    ? currentPath.split('/').slice(0, -1).join('/')
    : '';
  const joined = currentDir ? `${currentDir}/${stripped}` : stripped;
  // Normalize . and ..
  const resolved: string[] = [];
  for (const part of joined.split('/')) {
    if (part === '..') resolved.pop();
    else if (part !== '' && part !== '.') resolved.push(part);
  }
  return resolved.join('/');
}

// Inject inline styles for MkDocs custom classes before the HTML hits the DOM.
// This is more reliable than CSS cascade or useEffect DOM manipulation.
function injectCardStyles(raw: string): string {
  return raw
    .replace(/class="card-grid"/g, 'class="card-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:16px 0;"')
    .replace(/class="success-box"/g, 'class="success-box" style="min-width:0;overflow:hidden;word-break:break-all;overflow-wrap:break-word;background:rgba(0,204,102,0.08);border-left:4px solid #00cc66;padding:12px 16px;border-radius:4px;"')
    .replace(/class="kafka-container"/g, 'class="kafka-container" style="min-width:0;overflow:hidden;word-break:break-all;overflow-wrap:break-word;background:rgba(255,102,0,0.07);border-left:4px solid #ff6600;padding:12px 16px;border-radius:4px;"')
    .replace(/class="info-box"/g, 'class="info-box" style="min-width:0;overflow:hidden;word-break:break-all;overflow-wrap:break-word;background:rgba(0,102,204,0.08);border-left:4px solid #0066cc;padding:12px 16px;border-radius:4px;"')
    .replace(/class="container-section"/g, 'class="container-section" style="min-width:0;overflow:hidden;word-break:break-all;overflow-wrap:break-word;background:rgba(36,150,237,0.06);border-left:4px solid #2496ed;padding:12px 16px;border-radius:4px;"');
}

export const DocViewer = ({ content, html, currentPath = '', onNavigate }: DocViewerProps) => {
  const c = useColors();
  const classes = useStyles(c);
  const dark = c.isDark;
  const containerRef = useRef<HTMLDivElement>(null);

  // Each entry owns its root — we call root.render() (not createRoot) when only dark changes
  const blockDataRef = useRef<Array<{ div: HTMLDivElement; root: ReactDOMClient.Root; code: string; language: string; title?: string }>>([]);
  const prevHtmlRef = useRef('');

  // Use refs so onNavigate/currentPath changes don't cause the heavy DOM effect to re-run
  const onNavigateRef = useRef(onNavigate);
  const currentPathRef = useRef(currentPath);
  useEffect(() => { onNavigateRef.current = onNavigate; });
  useEffect(() => { currentPathRef.current = currentPath; });

  // Unmount all roots when component unmounts
  useEffect(() => {
    return () => {
      blockDataRef.current.forEach(b => { try { b.root.unmount(); } catch (_) { /* ignore */ } });
      blockDataRef.current = [];
    };
  }, []);

  // Post-process HTML: replace code blocks and fix callouts that weren't converted by backend
  useEffect(() => {
    if (!html || !containerRef.current) return;

    // Always update CSS vars so tab colors update on dark/light switch without re-parsing HTML
    containerRef.current.style.setProperty('--tab-border', c.border);
    containerRef.current.style.setProperty('--tab-active-fg', c.text);
    containerRef.current.style.setProperty('--tab-inactive-fg', c.textMuted);
    containerRef.current.style.setProperty('--tab-bar-bg', c.surface);
    containerRef.current.style.setProperty('--tab-active-bg', dark ? c.inputBg : c.surfaceSubtle);

    const htmlChanged = prevHtmlRef.current !== html;

    if (htmlChanged) {
      // HTML changed — unmount old roots, re-parse DOM
      blockDataRef.current.forEach(b => { try { b.root.unmount(); } catch (_) { /* ignore */ } });
      blockDataRef.current = [];
      prevHtmlRef.current = html;

      // 1. Replace <pre data-code-block> with div placeholders, create roots
      const blocks = Array.from(containerRef.current.querySelectorAll('pre[data-code-block]'));
      blocks.forEach(pre => {
        const lang = pre.getAttribute('data-language') || 'text';
        const title = pre.getAttribute('data-title') || undefined;
        const code = pre.querySelector('code')?.textContent ?? '';
        const div = document.createElement('div');
        pre.parentNode?.insertBefore(div, pre);
        pre.remove();
        const root = ReactDOMClient.createRoot(div);
        blockDataRef.current.push({ div, root, code, language: lang, title });
      });

      // 2. Fix any > [!TYPE] blockquotes that the backend didn't convert (e.g. from cache)
      const CALLOUT_MAP: Record<string, { color: string; bg: string; border: string; icon: string; label: string }> = {
        NOTE:      { color: '#3b82f6', bg: 'rgba(59,130,246,0.07)',  border: 'rgba(59,130,246,0.25)',  icon: 'ℹ️',  label: 'Note' },
        INFO:      { color: '#3b82f6', bg: 'rgba(59,130,246,0.07)',  border: 'rgba(59,130,246,0.25)',  icon: 'ℹ️',  label: 'Info' },
        TIP:       { color: '#10b981', bg: 'rgba(16,185,129,0.07)',  border: 'rgba(16,185,129,0.25)',  icon: '💡', label: 'Tip' },
        WARNING:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)',  border: 'rgba(245,158,11,0.25)',  icon: '⚠️', label: 'Warning' },
        IMPORTANT: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.07)', border: 'rgba(139,92,246,0.25)', icon: '📌', label: 'Important' },
        CAUTION:   { color: '#ef4444', bg: 'rgba(239,68,68,0.07)',   border: 'rgba(239,68,68,0.25)',   icon: '🔴', label: 'Caution' },
        ERROR:     { color: '#ef4444', bg: 'rgba(239,68,68,0.07)',   border: 'rgba(239,68,68,0.25)',   icon: '🚨', label: 'Error' },
        DEFAULT:   { color: '#6b7280', bg: 'rgba(107,114,128,0.07)', border: 'rgba(107,114,128,0.25)', icon: 'ℹ️', label: 'Note' },
      };
      const blockquotes = Array.from(containerRef.current.querySelectorAll('blockquote'));
      blockquotes.forEach(bq => {
        const firstP = bq.querySelector('p');
        const text = firstP?.textContent?.trim() ?? '';
        const m = text.match(/^\[!(NOTE|INFO|TIP|WARNING|IMPORTANT|CAUTION|ERROR|DEFAULT)\]$/i);
        if (!m) return;
        const s = CALLOUT_MAP[m[1].toUpperCase()];
        if (!s) return;
        const wrapper = document.createElement('div');
        wrapper.style.cssText = `background:${s.bg};border:1px solid ${s.border};border-radius:8px;padding:12px 16px;margin-bottom:20px`;
        const titleEl = document.createElement('div');
        titleEl.style.cssText = `display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:0.875rem;font-weight:600;color:${s.color};font-family:"Geist",sans-serif`;
        titleEl.innerHTML = `<span>${s.icon}</span><span>${s.label}</span>`;
        const bodyEl = document.createElement('div');
        bodyEl.style.cssText = 'font-size:0.9375rem;line-height:1.65';
        Array.from(bq.children).forEach(child => {
          if (child === firstP) return;
          bodyEl.appendChild(child.cloneNode(true));
        });
        wrapper.appendChild(titleEl);
        if (bodyEl.childElementCount > 0) wrapper.appendChild(bodyEl);
        bq.parentNode?.replaceChild(wrapper, bq);
      });

      // 3. Make .nh-tabs interactive via DOM manipulation
      // Colors use CSS custom properties (set above) so dark/light switch works without re-parsing HTML
      const nhTabs = Array.from(containerRef.current.querySelectorAll('.nh-tabs'));
      nhTabs.forEach(tabsEl => {
        const tabs = Array.from(tabsEl.querySelectorAll(':scope > .nh-tab')) as HTMLElement[];
        if (tabs.length < 2) return;
        const tabBar = document.createElement('div');
        tabBar.style.cssText = `display:flex;border-bottom:1px solid var(--tab-border);background:var(--tab-bar-bg);border-radius:8px 8px 0 0;overflow:hidden`;
        const buttons: HTMLButtonElement[] = [];
        const activate = (idx: number) => {
          tabs.forEach((t, j) => { t.style.display = j === idx ? '' : 'none'; });
          buttons.forEach((b, j) => {
            b.style.setProperty('color', j === idx ? 'var(--tab-active-fg)' : 'var(--tab-inactive-fg)');
            b.style.fontWeight = j === idx ? '600' : '400';
            b.style.setProperty('border-bottom', j === idx ? '2px solid var(--tab-active-fg)' : '2px solid transparent');
            b.style.setProperty('background', j === idx ? 'var(--tab-active-bg)' : 'transparent');
          });
        };
        tabs.forEach((tab, i) => {
          const labelEl = tab.querySelector('.nh-tab-label') as HTMLElement | null;
          const label = labelEl?.textContent?.trim() || `Tab ${i + 1}`;
          if (labelEl) labelEl.style.display = 'none';
          const btn = document.createElement('button');
          btn.textContent = label;
          btn.style.cssText = `padding:8px 16px;font-size:0.8125rem;font-family:"Geist",sans-serif;border:none;border-right:1px solid var(--tab-border);cursor:pointer;margin-bottom:-1px;transition:color 0.1s;outline:none`;
          btn.addEventListener('click', () => activate(i));
          buttons.push(btn);
          tabBar.appendChild(btn);
        });
        (tabsEl as HTMLElement).style.cssText = `border:1px solid var(--tab-border);border-radius:8px;overflow:hidden;margin-bottom:20px`;
        tabsEl.insertBefore(tabBar, tabsEl.firstChild);
        tabs.forEach(t => {
          const tabContent = t.querySelector('.nh-tab-content') as HTMLElement | null;
          if (tabContent) tabContent.style.cssText = `padding:16px 20px;background:var(--tab-active-bg)`;
        });
        activate(0);
      });

      // 5. Handle links: anchor links → smooth scroll; external links → new tab
      const container = containerRef.current;
      const findById = (rawId: string): HTMLElement | null => {
        const normalized = rawId.toLowerCase().replace(/[^\w-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const candidates = [rawId, rawId.toLowerCase(), normalized];
        for (const id of candidates) {
          try {
            const el = container.querySelector(`[id="${CSS.escape(id)}"]`) as HTMLElement | null;
            if (el) return el;
          } catch { /* invalid selector, skip */ }
        }
        const allWithId = Array.from(container.querySelectorAll('[id]')) as HTMLElement[];
        return allWithId.find(el => el.id.toLowerCase() === normalized) ?? null;
      };
      const anchors = Array.from(container.querySelectorAll('a[href]'));
      anchors.forEach(a => {
        const href = a.getAttribute('href') ?? '';
        if (href.startsWith('#')) {
          a.addEventListener('click', (e: Event) => {
            e.preventDefault();
            const rawId = decodeURIComponent(href.slice(1));
            const target = findById(rawId);
            if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        } else if (/^(https?:|\/\/|mailto:|data:|tel:)/.test(href)) {
          a.setAttribute('target', '_blank');
          a.setAttribute('rel', 'noopener noreferrer');
        } else if (href) {
          const resolved = resolveDocPath(href, currentPathRef.current);
          if (resolved) {
            // Rewrite href so browser status bar shows resolved path, not raw relative .md URL
            a.setAttribute('href', `#doc:${resolved}`);
            a.addEventListener('click', (e: Event) => {
              e.preventDefault();
              if (onNavigateRef.current) onNavigateRef.current(resolved);
            });
          }
        }
      });
    } // end if (htmlChanged)

    // Always re-render CodeBlocks (into existing roots) with current dark value.
    // On html change: roots were just created above. On dark change: roots already exist — just re-render.
    blockDataRef.current.forEach(({ root, code, language, title }) => {
      root.render(React.createElement(CodeBlock, { code, language, dark, title }));
    });

    // Always apply card styles — runs on every effect so HMR/state preservation doesn't skip it
    Array.from(containerRef.current.querySelectorAll('.card-grid') as NodeListOf<HTMLElement>).forEach(el => {
      el.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:16px 0;';
    });
    Array.from(containerRef.current.querySelectorAll('.success-box,.kafka-container,.info-box,.container-section') as NodeListOf<HTMLElement>).forEach(el => {
      const cls = el.className;
      let color: string;
      let bg: string;
      if (cls.includes('success-box')) {
        color = '#00cc66';
        bg = 'rgba(0,204,102,0.08)';
      } else if (cls.includes('kafka-container')) {
        color = '#ff6600';
        bg = 'rgba(255,102,0,0.07)';
      } else if (cls.includes('info-box')) {
        color = '#0066cc';
        bg = 'rgba(0,102,204,0.08)';
      } else {
        color = '#2496ed';
        bg = 'rgba(36,150,237,0.06)';
      }
      el.style.cssText = `min-width:0;overflow:hidden;word-break:break-all;overflow-wrap:break-word;background:${bg};border-left:4px solid ${color};padding:12px 16px;border-radius:4px;margin-bottom:0;`;
      (el.querySelectorAll('p') as NodeListOf<HTMLElement>).forEach(p => { p.style.marginBottom = '0'; });
    });

  // Re-run when html or dark changes. onNavigate/currentPath are read via refs.
  }, [html, dark, c]);

  // ── HTML mode (backend-compiled MDX) ────────────────────────────────────
  if (html) {
    return (
      <div
        ref={containerRef}
        className={classes.root}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: injectCardStyles(html) }}
      />
    );
  }

  // ── Fallback: react-markdown ─────────────────────────────────────────────
  const processed = preprocessCallouts(content);
  return (
    <div className={classes.root}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          h1: makeHeading(1),
          h2: makeHeading(2),
          h3: makeHeading(3),
          h4: makeHeading(4),
          a: ({ href, children }: any) => {
            if (!href) return <span>{children}</span>;
            if (/^(https?:|\/\/|mailto:|data:|tel:)/.test(href)) return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
            const resolved = resolveDocPath(href, currentPath);
            return <a href={`#doc:${resolved}`} onClick={(e) => { e.preventDefault(); if (onNavigate && resolved) onNavigate(resolved); }}>{children}</a>;
          },
          blockquote: ({ children }: any) => <CalloutBlock>{children}</CalloutBlock>,
          // Remove react-markdown's default <pre> wrapper — CodeBlock has its own
          pre: ({ children }: any) => <>{children}</>,
          code({ className, children }: any) {
            // react-markdown v8: use className presence to distinguish fenced vs inline
            const match = /language-(\w+)/.exec(className || '');
            if (!match) return <code className={className}>{children}</code>;
            return <CodeBlock code={String(children).replace(/\n$/, '')} language={match[1]} dark={dark} />;
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
};
