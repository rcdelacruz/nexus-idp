import { getColors } from '@stratpoint/theme-utils';
import React from 'react';
import { SignInPage, UserIdentity } from '@backstage/core-components';
import { googleAuthApiRef, useApi, configApiRef } from '@backstage/core-plugin-api';
import { NexusLogoFull, NexusLogoHorizontal } from '../Root/NexusLogo';
import {
  LayoutGrid, BookOpen, Code2, HardDrive, DollarSign,
  Radar, Zap, ArrowRight,
} from 'lucide-react';

const FONT = '"Geist", "Helvetica Neue", Arial, sans-serif';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
);

const FEATURES = [
  { icon: LayoutGrid, title: 'Service Catalog', desc: 'Discover and manage all software components, services, and APIs' },
  { icon: Code2, title: 'Scaffolder', desc: 'Create new components from standardized templates' },
  { icon: BookOpen, title: 'Documentation', desc: 'Technical docs for every component in the organization' },
  { icon: DollarSign, title: 'FinOps', desc: 'Cost visibility, rightsizing, and unused resources' },
  { icon: HardDrive, title: 'Local Provisioner', desc: 'Manage resources provisioned to your local dev machine' },
  { icon: Radar, title: 'Tech Radar', desc: 'Track technology adoption across the organization' },
] as const;

export const CustomSignInPage = (props: any) => {
  const c = getColors(true); // a dark page whatever the saved theme (nothing has loaded the theme yet)
  const googleAuthApi = useApi(googleAuthApiRef);
  const configApi = useApi(configApiRef);
  const githubOwner = configApi.getOptionalString('organization.githubOwner') ?? 'your-github-org';
  const orgDomain = configApi.getOptionalString('organization.domain') ?? 'yourdomain.com';
  const orgName = configApi.getOptionalString('organization.name') ?? 'Nexus IDP';
  const hiddenRef = React.useRef<HTMLDivElement>(null);
  const [checking, setChecking] = React.useState(true);
  const [ready, setReady] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [hovering, setHovering] = React.useState(false);

  const provider = {
    id: 'google',
    title: 'Google',
    message: 'Sign in using Google',
    apiRef: googleAuthApiRef,
  };

  React.useEffect(() => {
    let cancelled = false;
    googleAuthApi.getBackstageIdentity({ optional: true })
      .then(async identity => {
        if (cancelled) return;
        if (identity) {
          const profile = await googleAuthApi.getProfile();
          props.onSignInSuccess(
            UserIdentity.create({ identity: identity.identity, authApi: googleAuthApi, profile }),
          );
          return;
        }
        setChecking(false);
        setTimeout(() => setReady(true), 30);
      })
      .catch(() => {
        if (cancelled) return;
        setChecking(false);
        setTimeout(() => setReady(true), 30);
      });
    return () => { cancelled = true; };
  }, [googleAuthApi]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSignIn = () => {
    setLoading(true);
    const btn = hiddenRef.current?.querySelector('button');
    btn?.click();
  };

  let buttonBackground = 'transparent';
  if (loading) {
    buttonBackground = c.surface;
  } else if (hovering) {
    buttonBackground = c.avatarBg;
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: c.bg,
      backgroundImage: `radial-gradient(circle, ${c.border} 1px, transparent 1px)`,
      backgroundSize: '24px 24px',
      fontFamily: FONT,
      color: c.text,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* ── Nav bar ──────────────────────────────────────────────────────── */}
      <nav style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px',
        height: 64,
        borderBottom: `1px solid ${c.border}`,
      }}>
        <NexusLogoHorizontal />
        <div style={{
          opacity: ready ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}>
          <button
            onClick={handleSignIn}
            disabled={loading || !ready}
            aria-label="Sign in with Google"
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              height: 36,
              padding: '0 16px',
              borderRadius: 6,
              border: `1px solid ${hovering && !loading ? c.borderHover : c.border}`,
              background: buttonBackground,
              color: loading ? c.textDisabled : c.text,
              fontSize: '0.875rem',
              fontWeight: 500,
              letterSpacing: '-0.006em',
              cursor: loading ? 'default' : 'pointer',
              transition: 'border-color 0.15s, background 0.15s, color 0.15s',
              fontFamily: 'inherit',
            }}
          >
            {loading ? 'Signing in\u2026' : (
              <>
                <GoogleIcon />
                Sign In
              </>
            )}
          </button>
        </div>
      </nav>

      {/* ── Session check indicator ────────────────────────────────────── */}
      {checking && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          background: c.bg,
        }}>
          <style>{`
            @keyframes logo-breathe {
              0%, 100% { opacity: 0.3; }
              50%       { opacity: 0.8; }
            }
          `}</style>
          <div style={{ width: 240, animation: 'logo-breathe 1.8s ease-in-out infinite' }}>
            <NexusLogoFull color={c.text} />
          </div>
        </div>
      )}

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 32px',
        textAlign: 'center',
        opacity: ready ? 1 : 0,
        transform: ready ? 'translateY(0)' : 'translateY(8px)',
        transition: 'opacity 0.5s ease, transform 0.5s ease',
      }}>
        {/* Hero content */}
        <div style={{ maxWidth: 720, marginBottom: 48 }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 12px',
            borderRadius: 100,
            border: `1px solid ${c.border}`,
            fontSize: '0.75rem',
            color: c.textMuted,
            marginBottom: 24,
          }}>
            <Zap size={12} strokeWidth={1.5} aria-hidden="true" />
            Internal Developer Platform
          </div>

          <h1 style={{
            fontSize: 'clamp(2.5rem, 5vw, 4rem)',
            fontWeight: 700,
            letterSpacing: '-0.06em',
            lineHeight: 1.05,
            margin: '0 0 16px',
            color: c.text,
          }}>
            Build, Ship &amp; Operate<br />
            <span style={{ color: c.textMuted }}>with Confidence</span>
          </h1>

          <p style={{
            fontSize: '1.125rem',
            color: c.textMuted,
            lineHeight: 1.6,
            letterSpacing: '-0.01em',
            margin: '0 0 32px',
            maxWidth: 560,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}>
            Your team's central hub for services, APIs, docs, infrastructure, and cost management — all in one place.
          </p>

          <button
            onClick={handleSignIn}
            disabled={loading || !ready}
            aria-label="Get started — sign in with Google"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              height: 44,
              padding: '0 24px',
              borderRadius: 8,
              border: 'none',
              background: c.text,
              color: c.bg,
              fontSize: '0.9375rem',
              fontWeight: 600,
              letterSpacing: '-0.01em',
              cursor: loading ? 'default' : 'pointer',
              fontFamily: 'inherit',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => { if (!loading) (e.target as HTMLElement).style.background = '#d4d4d4'; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.background = c.text; }}
          >
            {loading ? 'Signing in\u2026' : (
              <>
                Get Started
                <ArrowRight size={16} strokeWidth={2} aria-hidden="true" />
              </>
            )}
          </button>
        </div>

        {/* ── Features grid ──────────────────────────────────────────────── */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          maxWidth: 900,
          width: '100%',
          marginBottom: 48,
        }}>
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              style={{
                padding: '16px 18px',
                borderRadius: 8,
                border: `1px solid ${c.border}`,
                background: c.surface,
                textAlign: 'left',
              }}
            >
              <div style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: c.avatarBg,
                border: `1px solid ${c.border}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 10,
              }}>
                <Icon size={14} strokeWidth={1.5} color={c.textMuted} aria-hidden="true" />
              </div>
              <div style={{
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: c.text,
                letterSpacing: '-0.01em',
                marginBottom: 4,
              }}>
                {title}
              </div>
              <div style={{
                fontSize: '0.75rem',
                color: c.textMuted,
                lineHeight: 1.5,
              }}>
                {desc}
              </div>
            </div>
          ))}
        </div>

      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer style={{
        borderTop: `1px solid ${c.border}`,
        padding: '24px 32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: '0.75rem', color: c.textDisabled }}>
            &copy; {new Date().getFullYear()} {orgName}
          </span>
          <span style={{ fontSize: '0.75rem', color: c.border }}>&middot;</span>
          <span style={{ fontSize: '0.75rem', color: c.textDisabled }}>
            Powered by Nexus IDP
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <a
            href={`https://github.com/${githubOwner}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '0.75rem', color: c.textMuted, textDecoration: 'none' }}
          >
            GitHub
          </a>
          <a
            href={`https://${orgDomain}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '0.75rem', color: c.textMuted, textDecoration: 'none' }}
          >
            {orgDomain}
          </a>
        </div>
      </footer>

      {/* Hidden SignInPage — handles the Google popup flow */}
      <div ref={hiddenRef} style={{ display: 'none' }}>
        <SignInPage {...props} provider={provider} />
      </div>
    </div>
  );
};
