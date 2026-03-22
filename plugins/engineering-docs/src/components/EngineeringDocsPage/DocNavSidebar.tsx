import React, { useState, useRef } from 'react';
import { makeStyles } from '@material-ui/core';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { NavItem } from '../../api/types';

const useStyles = makeStyles(theme => ({
  sidebar: {
    width: 240,
    flexShrink: 0,
    overflowY: 'auto',
    height: '100%',
    borderRight: `1px solid ${theme.palette.type === 'dark' ? '#2e2e2e' : '#ebebeb'}`,
    background: theme.palette.type === 'dark' ? '#0a0a0a' : '#fafafa',
    padding: '24px 0 8px',
    '&::-webkit-scrollbar': { width: 4 },
    '&::-webkit-scrollbar-track': { background: 'transparent' },
    '&::-webkit-scrollbar-thumb': {
      background: theme.palette.type === 'dark' ? '#2e2e2e' : '#ebebeb',
      borderRadius: 2,
    },
  },
  sectionLabel: {
    padding: '4px 16px 8px',
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    color: theme.palette.type === 'dark' ? '#454545' : '#8f8f8f',
    fontFamily: '"Geist", "Helvetica Neue", Arial, sans-serif',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 12px',
    margin: '1px 8px',
    height: 32,
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: 500,
    letterSpacing: '-0.006em',
    fontFamily: '"Geist", "Helvetica Neue", Arial, sans-serif',
    color: theme.palette.type === 'dark' ? '#878787' : '#4d4d4d',
    userSelect: 'none' as const,
    transition: 'color 0.1s, background 0.1s',
    '&:hover': {
      background: theme.palette.type === 'dark' ? '#1a1a1a' : '#f2f2f2',
      color: theme.palette.type === 'dark' ? '#ededed' : '#171717',
    },
  },
  active: {
    background: theme.palette.type === 'dark' ? '#1f1f1f' : '#ebebeb',
    color: `${theme.palette.type === 'dark' ? '#ededed' : '#171717'} !important`,
    fontWeight: 600,
  },
  divider: {
    height: 1,
    background: theme.palette.type === 'dark' ? '#2e2e2e' : '#ebebeb',
    margin: '8px 0',
  },
}));

interface NavRowProps {
  item: NavItem;
  depth: number;
  selectedPath: string;
  onSelect: (path: string) => void;
}

const NavRow = ({ item, depth, selectedPath, onSelect }: NavRowProps) => {
  const classes = useStyles();
  const isActive = selectedPath === item.path;
  const isAncestor = selectedPath.startsWith(item.path + '/');
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const prevSelectedRef = useRef(selectedPath);
  // Reset manual override when selectedPath moves into or out of this dir
  if (prevSelectedRef.current !== selectedPath) {
    prevSelectedRef.current = selectedPath;
    if (isAncestor) setManualOpen(null);
  }
  // Auto-expand when selectedPath is inside this dir; respect manual toggle otherwise
  const open = manualOpen !== null ? manualOpen : isAncestor;
  const paddingLeft = 12 + depth * 12;

  if (item.type === 'dir') {
    return (
      <>
        <div
          className={`${classes.item} ${isActive ? classes.active : ''}`}
          style={{ paddingLeft }}
          onClick={() => setManualOpen(o => o === null ? !isAncestor : !o)}
        >
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.label}
          </span>
          {open
            ? <ChevronDown size={14} strokeWidth={1.5} style={{ flexShrink: 0 }} />
            : <ChevronRight size={14} strokeWidth={1.5} style={{ flexShrink: 0 }} />
          }
        </div>
        {open && item.children?.map(child => (
          <NavRow
            key={child.path}
            item={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
      </>
    );
  }

  return (
    <div
      className={`${classes.item} ${isActive ? classes.active : ''}`}
      style={{ paddingLeft }}
      onClick={() => onSelect(item.path)}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.label}
      </span>
    </div>
  );
};

interface DocNavSidebarProps {
  nav: NavItem[];
  selectedPath: string;
  onSelect: (path: string) => void;
}

export const DocNavSidebar = ({ nav, selectedPath, onSelect }: DocNavSidebarProps) => {
  const classes = useStyles();
  return (
    <div className={classes.sidebar}>
      {nav.map(item => (
        <NavRow
          key={item.path}
          item={item}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
};
