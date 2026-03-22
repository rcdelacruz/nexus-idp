import React, { useEffect, useState } from 'react';
import { makeStyles } from '@material-ui/core';

export interface TocEntry {
  id: string;
  label: string;
  level: 2 | 3;
}

// Extract TOC from pre-rendered HTML (guaranteed ID alignment with DOM)
export function extractTocFromHtml(html: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const re = /<h([23])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h[23]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const level = parseInt(m[1], 10) as 2 | 3;
    const id = m[2];
    // Strip inner HTML tags to get plain text label
    const label = m[3].replace(/<[^>]+>/g, '').trim();
    if (id && label) entries.push({ id, label, level });
  }
  return entries;
}

export function extractToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const seen = new Map<string, number>();
  const lines = markdown.split('\n');
  for (const line of lines) {
    const m2 = line.match(/^##\s+(.+)$/);
    const m3 = line.match(/^###\s+(.+)$/);
    const match = m2 ?? m3;
    if (!match) continue;
    const level = m2 ? 2 : 3;
    const base = slugify(match[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count}`;
    entries.push({ id, label: match[1].trim(), level });
  }
  return entries;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

const useStyles = makeStyles(theme => {
  const dark = theme.palette.type === 'dark';
  return {
    toc: {
      width: 220,
      flexShrink: 0,
      padding: '32px 0 32px 24px',
      overflowY: 'auto',
      height: '100%',
      '&::-webkit-scrollbar': { width: 0 },
    },
    label: {
      fontSize: '0.6875rem',
      fontWeight: 600,
      letterSpacing: '0.06em',
      textTransform: 'uppercase' as const,
      color: dark ? '#454545' : '#8f8f8f',
      fontFamily: '"Geist", "Helvetica Neue", Arial, sans-serif',
      marginBottom: 12,
    },
    entry: {
      display: 'block',
      fontSize: '0.8125rem',
      fontFamily: '"Geist", "Helvetica Neue", Arial, sans-serif',
      letterSpacing: '-0.006em',
      lineHeight: 1.5,
      padding: '3px 0',
      cursor: 'pointer',
      textDecoration: 'none',
      color: dark ? '#878787' : '#8f8f8f',
      transition: 'color 0.1s',
      '&:hover': {
        color: dark ? '#ededed' : '#171717',
      },
    },
    active: {
      color: `${dark ? '#ededed' : '#171717'} !important`,
      fontWeight: 500,
    },
    h3: {
      paddingLeft: 12,
    },
  };
});

interface DocTOCProps {
  entries: TocEntry[];
}

export const DocTOC = ({ entries }: DocTOCProps) => {
  const classes = useStyles();
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    if (entries.length === 0) return;

    const observer = new IntersectionObserver(
      observed => {
        const visible = observed.filter(e => e.isIntersecting);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: '0px 0px -60% 0px', threshold: 0 },
    );

    entries.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <div className={classes.toc}>
      <div className={classes.label}>On this page</div>
      {entries.map(({ id, label, level }) => (
        <a
          key={id}
          href={`#${id}`}
          className={`${classes.entry} ${level === 3 ? classes.h3 : ''} ${activeId === id ? classes.active : ''}`}
          onClick={e => {
            e.preventDefault();
            const el = document.getElementById(id);
            if (el) {
              // Find the nearest scrollable ancestor
              let parent = el.parentElement;
              while (parent && parent.scrollHeight <= parent.clientHeight) {
                parent = parent.parentElement;
              }
              if (parent) {
                const offset = el.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop - 20;
                parent.scrollTo({ top: offset, behavior: 'smooth' });
              } else {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }
            setActiveId(id);
          }}
        >
          {label}
        </a>
      ))}
    </div>
  );
};
