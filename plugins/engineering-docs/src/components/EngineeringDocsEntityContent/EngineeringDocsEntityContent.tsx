import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Progress, ErrorPanel, EmptyState } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { makeStyles, Box } from '@material-ui/core';
import { engineeringDocsApiRef } from '../../api/EngineeringDocsClient';
import { NavItem, DocContent } from '../../api/types';
import { DocNavSidebar } from '../EngineeringDocsPage/DocNavSidebar';
import { DocViewer } from '../EngineeringDocsPage/DocViewer';
import { DocTOC, extractToc, extractTocFromHtml } from '../EngineeringDocsPage/DocTOC';

// ─── Annotation constants ────────────────────────────────────────────────────

export const ENGINEERING_DOCS_SOURCE_ANNOTATION = 'engineering-docs/source-id';
export const ENGINEERING_DOCS_REPO_ANNOTATION = 'engineering-docs/repo';
export const ENGINEERING_DOCS_BRANCH_ANNOTATION = 'engineering-docs/branch';
export const ENGINEERING_DOCS_BASE_ANNOTATION = 'engineering-docs/content-base';
const GITHUB_PROJECT_SLUG = 'github.com/project-slug';

/** Resolve which repo/source to use for an entity, in priority order. */
function resolveDocSource(annotations: Record<string, string>): {
  mode: 'source' | 'repo' | 'none';
  sourceId?: string;
  repo?: string;
  branch: string;
  contentBase: string;
} {
  const branch = annotations[ENGINEERING_DOCS_BRANCH_ANNOTATION] ?? 'main';
  const contentBase = annotations[ENGINEERING_DOCS_BASE_ANNOTATION] ?? 'docs';

  if (annotations[ENGINEERING_DOCS_SOURCE_ANNOTATION]) {
    return { mode: 'source', sourceId: annotations[ENGINEERING_DOCS_SOURCE_ANNOTATION], branch, contentBase };
  }
  if (annotations[ENGINEERING_DOCS_REPO_ANNOTATION]) {
    return { mode: 'repo', repo: annotations[ENGINEERING_DOCS_REPO_ANNOTATION], branch, contentBase };
  }
  // Fallback: use the entity's own GitHub repo with a `docs/` folder
  if (annotations[GITHUB_PROJECT_SLUG]) {
    return { mode: 'repo', repo: annotations[GITHUB_PROJECT_SLUG], branch, contentBase };
  }
  return { mode: 'none', branch, contentBase };
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles(() => ({
  layout: {
    display: 'flex',
    height: 'calc(100vh - 200px)',
    minHeight: 400,
    position: 'relative' as const,
  },
  contentScroll: {
    flex: 1,
    overflowY: 'auto' as const,
    minWidth: 0,
  },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Component ───────────────────────────────────────────────────────────────

export const EngineeringDocsEntityContent = () => {
  const classes = useStyles();
  const api = useApi(engineeringDocsApiRef);
  const { entity } = useEntity();
  const annotations = entity.metadata?.annotations ?? {};
  const source = resolveDocSource(annotations);

  const [nav, setNav] = useState<NavItem[]>([]);
  const [navLoading, setNavLoading] = useState(true);
  const [navError, setNavError] = useState<Error | undefined>();

  const [selectedPath, setSelectedPath] = useState('');
  const [doc, setDoc] = useState<DocContent | undefined>();
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<Error | undefined>();

  const layoutRef = useRef<HTMLDivElement>(null);

  // Track whether we fell back to README mode (no docs folder, just README.md)
  const [readmeMode, setReadmeMode] = useState(false);

  useEffect(() => {
    if (source.mode === 'none') return;
    setNavLoading(true);
    setNavError(undefined);
    setNav([]);
    setDoc(undefined);
    setSelectedPath('');
    setReadmeMode(false);

    const load = source.mode === 'source'
      ? api.getNav(source.sourceId)
      : api.getEntityNav(source.repo!, source.branch, source.contentBase);

    load
      .then(items => {
        // Empty nav (no docs folder or no .md/.mdx files) → fall back to README
        if (!items.length && source.mode === 'repo' && source.repo) {
          setReadmeMode(true);
          setNavLoading(false);
          setDocLoading(true);
          api.getEntityContent(source.repo, source.branch, '.', 'README')
            .then(content => { setDoc(content); setDocLoading(false); })
            .catch(readmeErr => { setNavError(readmeErr); setDocLoading(false); });
          return;
        }
        setNav(items);
        setNavLoading(false);
        const first = firstPagePath(items);
        if (first) setSelectedPath(first);
      })
      .catch(() => {
        // Nav call failed entirely — also try README fallback
        if (source.mode === 'repo' && source.repo) {
          setReadmeMode(true);
          setNavLoading(false);
          setDocLoading(true);
          api.getEntityContent(source.repo, source.branch, '.', 'README')
            .then(content => { setDoc(content); setDocLoading(false); })
            .catch(readmeErr => { setNavError(readmeErr); setDocLoading(false); });
        } else {
          setNavError(new Error('No docs or README found'));
          setNavLoading(false);
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.metadata.name]);

  useEffect(() => {
    if (!selectedPath || source.mode === 'none') return;
    setDocLoading(true);
    setDocError(undefined);

    const load = source.mode === 'source'
      ? api.getContent(selectedPath, source.sourceId)
      : api.getEntityContent(source.repo!, source.branch, source.contentBase, selectedPath);

    load
      .then(content => { setDoc(content); setDocLoading(false); })
      .catch(e => { setDocError(e); setDocLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath]);

  const tocEntries = useMemo(() => {
    if (!doc) return [];
    if (doc.html) return extractTocFromHtml(doc.html);
    return extractToc(doc.content);
  }, [doc]);

  if (source.mode === 'none') {
    return (
      <EmptyState
        title="No docs found"
        missing="content"
        description={`Add an ${ENGINEERING_DOCS_REPO_ANNOTATION} annotation pointing to a GitHub repo with MDX files, or a ${ENGINEERING_DOCS_SOURCE_ANNOTATION} annotation referencing a configured source.`}
      />
    );
  }

  // README mode: no sidebar, just rendered README with optional TOC
  if (readmeMode) {
    return (
      <div ref={layoutRef} className={classes.layout}>
        <div className={classes.contentScroll}>
          {docLoading && <Progress />}
          {!docLoading && navError && (
            <Box p={4}>
              <EmptyState
                title="No docs found"
                missing="content"
                description="This project has no docs/ folder or README.md."
              />
            </Box>
          )}
          {!docLoading && !navError && doc && (
            <DocViewer content={doc.content} html={doc.html} currentPath="README.md" onNavigate={() => {}} />
          )}
        </div>
        {!docLoading && !navError && doc && tocEntries.length > 0 && (
          <DocTOC entries={tocEntries} />
        )}
      </div>
    );
  }

  return (
    <div ref={layoutRef} className={classes.layout}>
      {navLoading && <Progress />}
      {!navLoading && navError && (
        <Box p={4}>
          <EmptyState
            title="No docs found"
            missing="content"
            description={`Could not load docs: ${navError.message}. Make sure the repo has MDX files in the configured content base path.`}
          />
        </Box>
      )}
      {!navLoading && !navError && (
        <>
          <DocNavSidebar
            nav={nav}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
          />
          <div className={classes.contentScroll}>
            {docLoading && <Progress />}
            {!docLoading && docError && (
              <Box p={4}><ErrorPanel error={docError} /></Box>
            )}
            {!docLoading && !docError && doc && (
              <DocViewer content={doc.content} html={doc.html} currentPath={selectedPath} onNavigate={setSelectedPath} />
            )}
          </div>
          {!docLoading && !docError && doc && tocEntries.length > 0 && (
            <DocTOC entries={tocEntries} />
          )}
        </>
      )}
    </div>
  );
};
