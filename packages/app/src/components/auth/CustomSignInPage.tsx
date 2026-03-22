import React from 'react';
import { SignInPage, UserIdentity } from '@backstage/core-components';
import { googleAuthApiRef, useApi } from '@backstage/core-plugin-api';
import { NexusLogoFull } from '../Root/NexusLogo';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
);

export const CustomSignInPage = (props: any) => {
  const googleAuthApi = useApi(googleAuthApiRef);
  const hiddenRef = React.useRef<HTMLDivElement>(null);
  const [checking, setChecking] = React.useState(true);
  const [ready, setReady] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [hovering, setHovering] = React.useState(false);

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

  const provider = {
    id: 'google',
    title: 'Google',
    message: 'Sign in using Google',
    apiRef: googleAuthApiRef,
  };

  const handleSignIn = () => {
    setLoading(true);
    const btn = hiddenRef.current?.querySelector('button');
    btn?.click();
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#000',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '"Geist", "Helvetica Neue", Arial, sans-serif',
      backgroundImage: 'radial-gradient(circle, #2e2e2e 1px, transparent 1px)',
      backgroundSize: '24px 24px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        padding: '0 16px',
      }}>
        {/* Card — border fades in once session check fails */}
        <div style={{
          background: '#000',
          border: `1px solid ${ready ? '#2e2e2e' : 'transparent'}`,
          borderRadius: 12,
          padding: '24px 32px',
          transition: 'border-color 0.4s ease',
        }}>
          {/* Logo — pulses while checking session, settles when done */}
          <div style={{ marginBottom: checking ? 0 : 12, display: 'flex', justifyContent: 'center', transition: 'margin-bottom 0.4s ease' }}>
            <div style={{
              width: 240,
              animation: checking ? 'logo-breathe 1.8s ease-in-out infinite' : undefined,
              transition: 'opacity 0.4s ease',
            }}>
              <style>{`
                @keyframes logo-breathe {
                  0%, 100% { opacity: 0.3; }
                  50%       { opacity: 0.8; }
                }
              `}</style>
              <NexusLogoFull color="#ededed" />
            </div>
          </div>

          {/* Subtitle + button — fade in after session check */}
          <div style={{
            overflow: 'hidden',
            maxHeight: ready ? 200 : 0,
            opacity: ready ? 1 : 0,
            transition: 'max-height 0.4s ease, opacity 0.35s ease',
          }}>
            <p style={{
              margin: '0 0 16px',
              fontSize: '0.875rem',
              color: '#878787',
              letterSpacing: '-0.006em',
              lineHeight: 1.5,
              textAlign: 'center',
            }}>
              Use your <strong style={{ color: '#a1a1a1', fontWeight: 500 }}>@stratpoint.com</strong> account to continue.
            </p>

            <button
              onClick={handleSignIn}
              disabled={loading}
              onMouseEnter={() => setHovering(true)}
              onMouseLeave={() => setHovering(false)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                height: 40,
                borderRadius: 8,
                border: `1px solid ${hovering && !loading ? '#454545' : '#2e2e2e'}`,
                background: loading ? '#0a0a0a' : hovering ? '#1a1a1a' : '#000',
                color: loading ? '#454545' : '#ededed',
                fontSize: '0.875rem',
                fontWeight: 500,
                letterSpacing: '-0.006em',
                cursor: loading ? 'default' : 'pointer',
                transition: 'border-color 0.15s, background 0.15s, color 0.15s',
                fontFamily: 'inherit',
              }}
            >
              {loading ? (
                'Signing in\u2026'
              ) : (
                <>
                  <GoogleIcon />
                  Continue with Google
                </>
              )}
            </button>

            <div style={{
              margin: '16px 0 0',
              paddingTop: 16,
              borderTop: '1px solid #1a1a1a',
              textAlign: 'center',
            }}>
              <span style={{ fontSize: '0.75rem', color: '#454545', letterSpacing: '-0.003em' }}>
                Stratpoint Engineering · Internal Developer Portal
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden SignInPage — handles the Google popup flow */}
      <div ref={hiddenRef} style={{ display: 'none' }}>
        <SignInPage {...props} provider={provider} />
      </div>
    </div>
  );
};
