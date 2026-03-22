import React from 'react';
import './HomePage.css';
import { Page } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { CatalogApi } from '@backstage/catalog-client';
import useAsync from 'react-use/lib/useAsync';
import {
  LayoutGrid, BookOpen, Code2, Zap, HardDrive, FolderGit2,
  Users, School, Server, ArrowUpRight,
} from 'lucide-react';

const g = {
  bg:      'var(--ds-background-200)',
  bg100:   'var(--ds-background-100)',
  border:  'var(--border)',
  borderHv:'var(--border-hover)',
  fg1:     'var(--fg-primary)',
  fg2:     'var(--fg-secondary)',
  fg3:     'var(--fg-tertiary)',
  gray100: 'var(--ds-gray-100)',
  blue:    'var(--blue)',
};

const Tile = ({ icon: Icon, title, description, href }: {
  icon: React.ElementType; title: string; description: string; href: string;
}) => {
  const [hov, setHov] = React.useState(false);
  return (
    <a
      href={href}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        textDecoration: 'none',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '20px',
        background: g.bg100,
        border: `1px solid ${hov ? g.borderHv : g.border}`,
        borderRadius: 8,
        transition: 'border-color 0.15s',
      }}
    >
      <div>
        <div style={{ width: 32, height: 32, borderRadius: 7, background: g.gray100, border: `1px solid ${g.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
          <Icon size={14} strokeWidth={1.5} color={g.fg2} />
        </div>
        <div style={{ fontSize: '0.875rem', fontWeight: 600, letterSpacing: '-0.015em', color: g.fg1, marginBottom: 6 }}>
          {title}
        </div>
        <div style={{ fontSize: '0.8125rem', color: g.fg3, lineHeight: 1.6, letterSpacing: '-0.006em' }}>
          {description}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 20, fontSize: '0.8125rem', fontWeight: 500, color: hov ? g.fg1 : g.fg3, transition: 'color 0.15s' }}>
        Open <ArrowUpRight size={12} strokeWidth={2} style={{ transform: hov ? 'translate(1px,-1px)' : 'none', transition: 'transform 0.15s' }} />
      </div>
    </a>
  );
};

const SectionLabel = ({ children }: { children: string }) => (
  <div style={{ fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: g.fg3, marginBottom: 12 }}>
    {children}
  </div>
);

export const HomePage = () => {
  const catalogApi = useApi(catalogApiRef) as CatalogApi;

  const { value: stats } = useAsync(async () => {
    const [components, apis, teams, templates] = await Promise.all([
      catalogApi.getEntities({ filter: { kind: 'Component' }, fields: ['metadata.name'] }),
      catalogApi.getEntities({ filter: { kind: 'API' }, fields: ['metadata.name'] }),
      catalogApi.getEntities({ filter: { kind: 'Group' }, fields: ['metadata.name'] }),
      catalogApi.getEntities({ filter: { kind: 'Template' }, fields: ['metadata.name'] }),
    ]);
    return { components: components.items.length, apis: apis.items.length, teams: teams.items.length, templates: templates.items.length };
  }, []);

  return (
    <Page themeId="home">
      <div style={{ minHeight: '100vh', background: g.bg }}>
        <div className="hp-inner">

          {/* Hero */}
          <div style={{ paddingBottom: 40, borderBottom: `1px solid ${g.border}` }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' as const, color: g.fg3, border: `1px solid ${g.border}`, borderRadius: 100, padding: '5px 12px', marginBottom: 20 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#50e3c2', flexShrink: 0 }} />
              Nexus IDP
            </div>
            <h1 className="hp-title" style={{ color: g.fg1 }}>
              Build. Ship. Manage.
            </h1>
            <p style={{ margin: '0 0 24px', fontSize: '1rem', color: g.fg3, lineHeight: 1.7, maxWidth: 480, letterSpacing: '-0.01em' }}>
              Your unified platform for discovering services, managing infrastructure,
              and accelerating development across Stratpoint Engineering.
            </p>
            <div className="hp-hero-bottom">
              <div style={{ display: 'flex', gap: 10 }}>
                <a href="/catalog" style={{ display: 'inline-flex', alignItems: 'center', height: 36, padding: '0 16px', borderRadius: 6, fontSize: '0.875rem', fontWeight: 500, background: g.fg1, color: g.bg, textDecoration: 'none', letterSpacing: '-0.006em' }}>
                  Explore Catalog
                </a>
                <a href="/create" style={{ display: 'inline-flex', alignItems: 'center', height: 36, padding: '0 16px', borderRadius: 6, fontSize: '0.875rem', fontWeight: 500, color: g.fg2, textDecoration: 'none', border: `1px solid ${g.border}`, letterSpacing: '-0.006em' }}>
                  Create Component
                </a>
              </div>
              <div className="hp-stats">
                {[
                  { n: stats?.components ?? '—', label: 'Components' },
                  { n: stats?.apis ?? '—',        label: 'APIs' },
                  { n: stats?.teams ?? '—',        label: 'Teams' },
                  { n: stats?.templates ?? '—',    label: 'Templates' },
                ].map((s, i) => (
                  <React.Fragment key={s.label}>
                    {i > 0 && <div style={{ width: 1, height: 28, background: g.border, flexShrink: 0 }} />}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: '1.125rem', fontWeight: 600, letterSpacing: '-0.04em', color: g.fg1, lineHeight: 1, fontVariantNumeric: 'tabular-nums' as const }}>{s.n}</span>
                      <span style={{ fontSize: '0.6875rem', color: g.fg3, letterSpacing: '0.02em' }}>{s.label}</span>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>

          {/* Platform — 3 equal columns */}
          <div>
            <SectionLabel>Platform</SectionLabel>
            <div className="hp-grid-3">
              <Tile icon={LayoutGrid} title="Service Catalog" description="Discover and manage all your software components, services, libraries, and APIs." href="/catalog" />
              <Tile icon={BookOpen}   title="Documentation"   description="Access comprehensive technical docs for every component in your organization."   href="/docs" />
              <Tile icon={Code2}      title="API Explorer"    description="Browse internal APIs, view schemas, and explore endpoint definitions."           href="/api-docs" />
            </div>
          </div>

          {/* Tooling — 4 equal columns */}
          <div>
            <SectionLabel>Tooling</SectionLabel>
            <div className="hp-grid-4">
              <Tile icon={Zap}        title="Scaffolder"           description="Create new components from standardized templates."       href="/create" />
              <Tile icon={Users}      title="Teams"                description="Organize and manage team ownership of components."        href="/catalog?filters%5Bkind%5D=group" />
              <Tile icon={FolderGit2} title="Project Registration" description="Register new projects and manage their metadata."          href="/project-registration" />
              <Tile icon={HardDrive}  title="Local Provisioner"    description="Manage resources provisioned to your local dev machine."   href="/local-provisioner" />
            </div>
          </div>

          {/* Local Dev — 3 equal columns */}
          <div>
            <SectionLabel>Local Development</SectionLabel>
            <div className="hp-grid-3">
              <Tile icon={School}    title="Training Templates" description="Provision Kafka, databases, and resources locally for hands-on learning." href="/create?filters%5Bkind%5D=template&filters%5Btype%5D=training&filters%5Buser%5D=all" />
              <Tile icon={HardDrive} title="Local Provisioner"  description="View and manage resources provisioned to your local development machine." href="/local-provisioner" />
              <Tile icon={Server}    title="Agent Setup Guide"  description="Install and configure the Backstage agent on your local machine."         href="/docs/default/component/backstage-agent" />
            </div>
          </div>

        </div>
      </div>
    </Page>
  );
};
