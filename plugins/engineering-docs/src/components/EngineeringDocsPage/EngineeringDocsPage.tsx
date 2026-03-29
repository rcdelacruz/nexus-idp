import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { Page, Header, Content, ErrorPanel } from '@backstage/core-components';
import { CircularProgress, IconButton, Tooltip } from '@material-ui/core';
import { useApi } from '@backstage/core-plugin-api';
import { makeStyles, Box } from '@material-ui/core';
import { useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { engineeringDocsApiRef } from '../../api/EngineeringDocsClient';
import { NavItem, DocContent, DocSource } from '../../api/types';
import { DocNavSidebar } from './DocNavSidebar';
import { DocViewer } from './DocViewer';
import { DocTOC, extractToc, extractTocFromHtml } from './DocTOC';

const useStyles = makeStyles(_theme => ({
  layout: {
    display: 'flex',
    overflow: 'hidden',
  },
  contentScroll: {
    flex: 1,
    overflowY: 'auto' as const,
    minWidth: 0,
    position: 'relative' as const,
  },
  refreshBtn: {
    position: 'absolute' as const,
    top: 12,
    right: 16,
    zIndex: 10,
    padding: 6,
    color: 'var(--fg-secondary)',
    '&:hover': {
      color: 'var(--fg-primary)',
      background: 'var(--ds-background-200)',
    },
  },
  spinning: {
    animation: '$spin 0.8s linear infinite',
  },
  '@keyframes spin': {
    from: { transform: 'rotate(0deg)' },
    to: { transform: 'rotate(360deg)' },
  },
  noPaddingTop: {
    paddingTop: '0 !important' as any,
  },
}));

function firstPagePath(items: NavItem[]): string | undefined {
  for (const item of items) {
    if (item.type === 'page') return item.path;
    if (item.children) {
      const found = firstPagePath(item.children);
      if (found) return found;
    }
  }
  return undefined;
}

export const EngineeringDocsPage = () => {
  const classes = useStyles();
  const api = useApi(engineeringDocsApiRef);
  const [searchParams, setSearchParams] = useSearchParams();
  const layoutRef = useRef<HTMLDivElement>(null);
  const [layoutHeight, setLayoutHeight] = useState('100vh');

  const [sources, setSources] = useState<DocSource[]>([]);

  // activeSourceId is derived from the URL — always in sync with sidebar clicks and internal changes
  const sourceParam = searchParams.get('source') ?? '';
  const [defaultSourceId, setDefaultSourceId] = useState('');
  const activeSourceId = sourceParam || defaultSourceId;


  const [nav, setNav] = useState<NavItem[]>([]);
  const [navLoading, setNavLoading] = useState(true);
  const [navError, setNavError] = useState<Error | undefined>();

  const [selectedPath, setSelectedPath] = useState<string>(searchParams.get('path') ?? '');
  const [doc, setDoc] = useState<DocContent | undefined>();
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<Error | undefined>();

  // Guards content fetch from firing with a stale path after a source switch
  const navSourceRef = useRef<string>('');

  // Load sources once; set default if URL has no source param
  useEffect(() => {
    api.getSources().then(s => {
      setSources(s);
      if (!sourceParam && s.length > 0) setDefaultSourceId(s[0].id);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Measure layout height
  useEffect(() => {
    const measure = () => {
      if (layoutRef.current) {
        const top = layoutRef.current.getBoundingClientRect().top;
        if (top > 0) setLayoutHeight(`calc(100vh - ${top}px)`);
      }
    };
    measure();
    const id = setTimeout(measure, 100);
    return () => clearTimeout(id);
  }, [navLoading]);

  // Reload nav whenever activeSourceId changes
  useEffect(() => {
    if (!activeSourceId) return;
    navSourceRef.current = '';
    setNavLoading(true);
    setNavError(undefined);
    setNav([]);
    setDoc(undefined);
    setSelectedPath('');
    api.getNav(activeSourceId)
      .then(items => {
        setNav(items);
        setNavLoading(false);
        const first = firstPagePath(items);
        if (first) {
          navSourceRef.current = activeSourceId;
          setSelectedPath(first);
        }
      })
      .catch(e => { setNavError(e); setNavLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSourceId]);

  // Fetch doc content — gated on navSourceRef to prevent stale source/path combos
  useEffect(() => {
    if (!selectedPath || !activeSourceId) return;
    if (navSourceRef.current !== activeSourceId) return;
    setDocLoading(true);
    setDocError(undefined);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('source', activeSourceId);
      next.set('path', selectedPath);
      return next;
    }, { replace: true });
    api.getContent(selectedPath, activeSourceId)
      .then(content => { setDoc(content); setDocLoading(false); })
      .catch(e => { setDocError(e); setDocLoading(false); });
  }, [selectedPath, activeSourceId, api, setSearchParams]);

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (!selectedPath || !activeSourceId || refreshing) return;
    setRefreshing(true);
    try {
      const [fresh, freshNav] = await Promise.all([
        api.refreshDoc(selectedPath, activeSourceId),
        api.refreshNav(activeSourceId),
      ]);
      setDoc(fresh);
      setNav(freshNav);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[engineering-docs] refresh failed:', e);
    } finally {
      setRefreshing(false);
    }
  }, [selectedPath, activeSourceId, refreshing, api]);

  const handleSelect = (path: string) => {
    navSourceRef.current = activeSourceId;
    setSelectedPath(path);
  };

  const tocEntries = useMemo(() => {
    if (!doc) return [];
    if (doc.html) return extractTocFromHtml(doc.html);
    return extractToc(doc.content);
  }, [doc]);

  const activeSource = sources.find(s => s.id === activeSourceId);
  const activeSourceLabel = activeSource?.label ?? 'Engineering Hub';
  const activeSourceSubtitle = activeSource?.description ?? '';

  return (
    <Page themeId="documentation">
      <Header
        title={activeSourceLabel}
        subtitle={activeSourceSubtitle}
      />
      <Content noPadding className={classes.noPaddingTop}>
        <div
          ref={layoutRef}
          className={classes.layout}
          style={{ height: layoutHeight }}
        >
          {navLoading && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CircularProgress size={40} thickness={3} />
            </div>
          )}
          {!navLoading && navError && <Box p={4}><ErrorPanel error={navError} /></Box>}
          {!navLoading && !navError && (
            <>
              <DocNavSidebar
                nav={nav}
                selectedPath={selectedPath}
                onSelect={handleSelect}
              />
              <div className={classes.contentScroll}>
                {!docLoading && !docError && doc && (
                  <Tooltip title="Refresh this page from GitHub" placement="left">
                    <IconButton
                      size="small"
                      className={classes.refreshBtn}
                      onClick={handleRefresh}
                      disabled={refreshing}
                      aria-label="Refresh doc"
                    >
                      <RefreshCw
                        size={14}
                        strokeWidth={1.5}
                        className={refreshing ? classes.spinning : undefined}
                      />
                    </IconButton>
                  </Tooltip>
                )}
                {docLoading && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: layoutHeight }}>
                    <CircularProgress size={36} thickness={3} />
                  </div>
                )}
                {!docLoading && docError && (
                  <Box p={4}><ErrorPanel error={docError} /></Box>
                )}
                {!docLoading && !docError && doc && (
                  <DocViewer
                    content={doc.content}
                    html={doc.html}
                    currentPath={selectedPath}
                    onNavigate={handleSelect}
                  />
                )}
              </div>
              {!docLoading && !docError && doc && tocEntries.length > 0 && (
                <DocTOC entries={tocEntries} />
              )}
            </>
          )}
        </div>
      </Content>
    </Page>
  );
};
