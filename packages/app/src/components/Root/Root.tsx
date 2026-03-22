import React, { PropsWithChildren, useEffect, useState } from 'react';
import { makeStyles, Menu, MenuItem } from '@material-ui/core';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { SidebarPage, useSidebarOpenState } from '@backstage/core-components';
import { Sidebar } from '@backstage/core-components';
import { useApi, identityApiRef, appThemeApiRef } from '@backstage/core-plugin-api';
import { SearchModal, useSearchModal } from '@backstage/plugin-search';
import {
  Home, LayoutGrid, BookOpen, Code2, Plus, Users, ClipboardList,
  HardDrive, DollarSign, Radar, Settings, Sun, Moon, Search, User, LogOut, LucideIcon,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import { NexusLogoMark } from './NexusLogo';
import { engineeringDocsApiRef } from '@internal/plugin-engineering-docs';
import { DocSource } from '@internal/plugin-engineering-docs';


const useStyles = makeStyles({
  // ---- Sidebar container override ----
  sidebarInner: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    background: '#000',
    overflow: 'hidden',
  },

  // ---- Logo area ----
  logoArea: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 16px',
    height: 72,
    boxSizing: 'border-box' as const,
    borderBottom: '1px solid #2e2e2e',
    textDecoration: 'none',
    flexShrink: 0,
  },
  logoText: {
    fontSize: '0.9375rem',
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color: '#ededed',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },

  // ---- Nav sections ----
  navScroll: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: '8px 0',
    '&::-webkit-scrollbar': { width: 0 },
  },
  sectionLabel: {
    padding: '12px 20px 4px',
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: '#454545',
    whiteSpace: 'nowrap',
  },
  navDivider: {
    height: 1,
    background: '#2e2e2e',
    margin: '8px 0',
    flexShrink: 0,
  },

  // ---- Nav item ----
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 12px',
    margin: '1px 8px',
    height: 36,
    borderRadius: 6,
    textDecoration: 'none',
    color: '#878787',
    fontSize: '0.875rem',
    fontWeight: 500,
    letterSpacing: '-0.006em',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    transition: 'color 0.15s, background 0.15s',
    cursor: 'pointer',
    border: 'none',
    background: 'transparent',
    width: 'calc(100% - 16px)',
    textAlign: 'left' as const,
    boxSizing: 'border-box' as const,
    '&:hover': {
      color: '#ededed',
      background: '#1a1a1a',
      textDecoration: 'none',
    },
  },
  navItemActive: {
    color: '#ededed !important',
    background: '#1f1f1f !important',
  },
  navIcon: {
    flexShrink: 0,
    color: 'inherit',
  },
  navLabel: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    color: 'inherit',
  },

  // ---- Docs submenu ----
  docsSubItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 12px 0 36px',
    margin: '1px 8px',
    height: 32,
    borderRadius: 6,
    textDecoration: 'none',
    color: '#666',
    fontSize: '0.8125rem',
    fontWeight: 500,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    transition: 'color 0.15s, background 0.15s',
    cursor: 'pointer',
    '&:hover': { color: '#ededed', background: '#1a1a1a', textDecoration: 'none' },
  },
  docsSubItemActive: {
    color: '#ededed !important',
    background: '#1f1f1f !important',
  },

  // ---- Bottom area ----
  bottomArea: {
    borderTop: '1px solid #2e2e2e',
    padding: '8px 0',
    flexShrink: 0,
  },
});

const SidebarSearch = () => {
  const classes = useStyles();
  const { isOpen } = useSidebarOpenState();
  const { state, toggleModal } = useSearchModal();
  return (
    <>
      <button className={classes.navItem} onClick={toggleModal}>
        <Search size={16} strokeWidth={1.5} className={classes.navIcon} />
        {isOpen && <span className={classes.navLabel}>Search</span>}
      </button>
      <SearchModal {...state} toggleModal={toggleModal} />
    </>
  );
};

const UserMenu = () => {
  const classes = useStyles();
  const { isOpen } = useSidebarOpenState();
  const identityApi = useApi(identityApiRef);
  const [anchor, setAnchor] = React.useState<null | HTMLElement>(null);
  const [picture, setPicture] = React.useState<string | undefined>();
  const [displayName, setDisplayName] = React.useState('Account');

  React.useEffect(() => {
    identityApi.getProfileInfo().then(p => {
      if (p.picture) setPicture(p.picture);
      if (p.displayName) setDisplayName(p.displayName);
    });
  }, [identityApi]);

  const avatar = picture
    ? <img src={picture} alt={displayName} style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
    : <User size={16} strokeWidth={1.5} className={classes.navIcon} />;

  return (
    <>
      <button className={classes.navItem} onClick={e => setAnchor(e.currentTarget)}>
        {avatar}
        {isOpen && <span className={classes.navLabel}>{displayName}</span>}
      </button>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        getContentAnchorEl={null}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        PaperProps={{ style: { minWidth: 160 } }}
      >
        <MenuItem
          onClick={() => { identityApi.signOut(); setAnchor(null); }}
          style={{ display: 'flex', alignItems: 'center', gap: 10 }}
        >
          <LogOut size={14} strokeWidth={1.5} />
          Sign out
        </MenuItem>
      </Menu>
    </>
  );
};


interface NavItemProps {
  icon: LucideIcon;
  label: string;
  to?: string;
  onClick?: () => void;
  exact?: boolean;
}

const NavItem = ({ icon: Icon, label, to, onClick, exact = false }: NavItemProps) => {
  const classes = useStyles();
  const { isOpen } = useSidebarOpenState();
  const location = useLocation();

  const isActive = to
    ? exact
      ? location.pathname === to
      : to !== '/' && location.pathname.startsWith(to)
    : false;

  const className = `${classes.navItem} ${isActive ? classes.navItemActive : ''}`;

  if (onClick || !to) {
    return (
      <button className={className} onClick={onClick}>
        <Icon size={16} strokeWidth={1.5} className={classes.navIcon} />
        {isOpen && <span className={classes.navLabel}>{label}</span>}
      </button>
    );
  }

  return (
    <Link to={to} className={className}>
      <Icon size={16} strokeWidth={1.5} className={classes.navIcon} />
      {isOpen && <span className={classes.navLabel}>{label}</span>}
    </Link>
  );
};

const DocsNavItem = () => {
  const classes = useStyles();
  const { isOpen } = useSidebarOpenState();
  const location = useLocation();
  const navigate = useNavigate();
  const api = useApi(engineeringDocsApiRef);
  const [sources, setSources] = useState<DocSource[]>([]);
  const [expanded, setExpanded] = useState(location.pathname.startsWith('/engineering-docs'));

  useEffect(() => {
    api.getSources().then(setSources).catch(() => {});
  }, [api]);

  // Keep expanded when on docs pages
  useEffect(() => {
    if (location.pathname.startsWith('/engineering-docs')) setExpanded(true);
  }, [location.pathname]);

  const isDocsActive = location.pathname.startsWith('/engineering-docs');
  const activeSourceId = new URLSearchParams(location.search).get('source') ?? '';

  const handleDocsClick = () => {
    if (sources.length > 0) {
      setExpanded(e => !e);
    } else {
      navigate('/engineering-docs');
    }
  };

  return (
    <>
      <button
        className={`${classes.navItem} ${isDocsActive ? classes.navItemActive : ''}`}
        onClick={handleDocsClick}
      >
        <BookOpen size={16} strokeWidth={1.5} className={classes.navIcon} />
        {isOpen && (
          <>
            <span className={classes.navLabel}>Docs</span>
            {sources.length > 0 && (
              expanded
                ? <ChevronDown size={13} strokeWidth={1.5} style={{ flexShrink: 0, color: '#666' }} />
                : <ChevronRight size={13} strokeWidth={1.5} style={{ flexShrink: 0, color: '#666' }} />
            )}
          </>
        )}
      </button>
      {isOpen && expanded && sources.map(source => (
        <Link
          key={source.id}
          to={`/engineering-docs?source=${source.id}`}
          className={`${classes.docsSubItem} ${activeSourceId === source.id ? classes.docsSubItemActive : ''}`}
        >
          {source.label}
        </Link>
      ))}
    </>
  );
};

const AppSidebar = () => {
  const classes = useStyles();
  const { isOpen } = useSidebarOpenState();
  const appThemeApi = useApi(appThemeApiRef);
  const [themeId, setThemeIdState] = useState(() => appThemeApi.getActiveThemeId() ?? 'dark');
  const isDark = themeId === 'dark';

  useEffect(() => {
    const subscription = appThemeApi.activeThemeId$().subscribe(id => {
      setThemeIdState(id ?? 'dark');
    });
    return () => subscription.unsubscribe();
  }, [appThemeApi]);

  const toggleTheme = () => appThemeApi.setActiveThemeId(isDark ? 'light' : 'dark');

  return (
    <div className={classes.sidebarInner}>
      {/* Logo */}
      <Link to="/" className={classes.logoArea}>
        <NexusLogoMark size={24} color="#ededed" />
        {isOpen && <span className={classes.logoText}>Nexus IDP</span>}
      </Link>

      {/* Search */}
      <SidebarSearch />

      {/* Main nav */}
      <div className={classes.navScroll}>
        {isOpen && <div className={classes.sectionLabel}>Platform</div>}
        <NavItem icon={Home} label="Home" to="/" exact />
        <NavItem icon={LayoutGrid} label="Catalog" to="/catalog" />
        <NavItem icon={Code2} label="APIs" to="/api-docs" />
        <DocsNavItem />
        <NavItem icon={Plus} label="Create" to="/create" />

        <div className={classes.navDivider} />

        {isOpen && <div className={classes.sectionLabel}>Tools</div>}
        <NavItem icon={ClipboardList} label="Register Project" to="/project-registration" />
        <NavItem icon={HardDrive} label="Local Provisioner" to="/local-provisioner" />
        <NavItem icon={Radar} label="Tech Radar" to="/tech-radar" />
        <NavItem icon={DollarSign} label="FinOps" to="/finops" />
      </div>

      {/* Bottom */}
      <div className={classes.bottomArea}>
        <NavItem
          icon={isDark ? Sun : Moon}
          label={isDark ? 'Light mode' : 'Dark mode'}
          onClick={toggleTheme}
        />
        <NavItem icon={Users} label="Teams" to="/catalog?filters%5Bkind%5D=group" />
        <NavItem icon={Settings} label="Settings" to="/settings" />
        <UserMenu />
      </div>
    </div>
  );
};

const PageTransition = ({ children }: PropsWithChildren<{}>) => {
  const [opacity, setOpacity] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpacity(1));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', opacity, transition: 'opacity 0.2s ease' }}>
      {children}
    </div>
  );
};

export const Root = ({ children }: PropsWithChildren<{}>) => (
  <RootContent>{children}</RootContent>
);

const RootContent = ({ children }: PropsWithChildren<{}>) => {
  const appThemeApi = useApi(appThemeApiRef);
  const [themeId, setThemeIdState] = useState(() => appThemeApi.getActiveThemeId() ?? 'dark');
  const isDark = themeId === 'dark';
  const location = useLocation();

  useEffect(() => {
    const subscription = appThemeApi.activeThemeId$().subscribe(id => {
      setThemeIdState(id ?? 'dark');
    });
    return () => subscription.unsubscribe();
  }, [appThemeApi]);

  useEffect(() => {
    document.documentElement.className = isDark ? 'theme-dark' : 'theme-light';
  }, [isDark]);

  useEffect(() => {
    const toggle = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 't') {
        appThemeApi.setActiveThemeId(isDark ? 'light' : 'dark');
      }
    };
    window.addEventListener('keydown', toggle);
    return () => window.removeEventListener('keydown', toggle);
  }, [appThemeApi, isDark]);

  const noSidebarPages = ['/device'];
  if (noSidebarPages.includes(location.pathname)) {
    return <>{children}</>;
  }

  return (
    <SidebarPage>
      <Sidebar>
        <AppSidebar />
      </Sidebar>
      <PageTransition key={location.pathname}>
        {children}
      </PageTransition>
    </SidebarPage>
  );
};
