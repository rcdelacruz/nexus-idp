import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  CircularProgress,
} from '@material-ui/core';
import { useApi, googleAuthApiRef, identityApiRef, discoveryApiRef } from '@backstage/core-plugin-api';
import { CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { useColors, semantic } from '@stratpoint/theme-utils';

export const DeviceAuthPage = () => {
  const c = useColors();
  const googleAuthApi = useApi(googleAuthApiRef);
  const identityApi = useApi(identityApiRef);
  const discoveryApi = useApi(discoveryApiRef);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const card: React.CSSProperties = {
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 8,
    padding: '20px 24px',
    maxWidth: 480,
    width: '100%',
    textAlign: 'center',
  };

  const sectionLabel: React.CSSProperties = {
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: c.textMuted,
    marginBottom: 12,
  };

  useEffect(() => {
    const checkAuth = async () => {
      try {
        await identityApi.getBackstageIdentity();
        setIsAuthenticated(true);
        setCheckingAuth(false);
        const redirectPath = sessionStorage.getItem('oauth-redirect');
        if (redirectPath === '/device') {
          sessionStorage.removeItem('oauth-redirect');
        }
      } catch {
        setIsAuthenticated(false);
        setCheckingAuth(false);
      }
    };
    checkAuth();
  }, [identityApi]);

  const handleSignIn = async () => {
    try {
      setLoading(true);
      sessionStorage.setItem('oauth-redirect', window.location.pathname);
      await googleAuthApi.getAccessToken(['openid', 'profile', 'email']);
      const redirectPath = sessionStorage.getItem('oauth-redirect');
      if (redirectPath && window.location.pathname !== redirectPath) {
        window.location.href = redirectPath;
        return;
      }
      sessionStorage.removeItem('oauth-redirect');
      await identityApi.getBackstageIdentity();
      setIsAuthenticated(true);
      setError('');
    } catch {
      setError('Failed to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token } = await identityApi.getCredentials();
      const baseUrl = await discoveryApi.getBaseUrl('local-provisioner');
      const response = await fetch(`${baseUrl}/agent/device/authorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ user_code: code.trim().toUpperCase() }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Authorization failed');
      }
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Failed to authorize device. Please check the code and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCodeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''));
  };

  const ErrorAlert = ({ message }: { message: string }) => (
    <Box
      role="alert"
      display="flex"
      alignItems="flex-start"
      style={{
        gap: 10,
        background: semantic.errorBg,
        border: `1px solid ${semantic.error}33`,
        borderRadius: 8,
        padding: '12px 14px',
        marginBottom: 16,
        textAlign: 'left',
      }}
    >
      <AlertCircle size={16} strokeWidth={1.5} color={semantic.error} style={{ marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
      <Typography style={{ fontSize: '0.8125rem', color: semantic.error, lineHeight: 1.5 }}>
        {message}
      </Typography>
    </Box>
  );

  if (checkingAuth) {
    return (
      <Box style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.bg, padding: 16 }}>
        <Box style={card}>
          <Loader size={32} strokeWidth={1.5} color={c.textMuted} style={{ margin: '0 auto 16px', display: 'block' }} aria-hidden="true" />
          <Typography style={{ fontSize: '1.25rem', fontWeight: 600, color: c.text, marginBottom: 8 }}>
            Checking authentication...
          </Typography>
          <Typography style={{ fontSize: '0.875rem', color: c.textSecondary }}>
            If not logged in, you'll be redirected to Google sign-in.
          </Typography>
        </Box>
      </Box>
    );
  }

  if (success) {
    return (
      <Box style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.bg, padding: 16 }}>
        <Box style={card}>
          <Box
            style={{
              width: 56, height: 56, borderRadius: '50%',
              background: semantic.successBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}
          >
            <CheckCircle size={28} strokeWidth={1.5} color={semantic.success} />
          </Box>
          <Typography style={{ fontSize: '1.25rem', fontWeight: 600, color: c.text, marginBottom: 8 }}>
            Device Authorized
          </Typography>
          <Typography style={{ fontSize: '0.875rem', color: c.textSecondary, marginBottom: 12 }}>
            You can now close this window and return to your terminal.
          </Typography>
          <Typography style={{ fontSize: '0.75rem', color: c.textMuted }}>
            Your Backstage agent is now authenticated and ready to use.
          </Typography>
        </Box>
      </Box>
    );
  }

  if (!isAuthenticated) {
    return (
      <Box style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.bg, padding: 16 }}>
        <Box style={card}>
          <p style={sectionLabel}>Device Authorization</p>
          <Typography style={{ fontSize: '1.25rem', fontWeight: 600, color: c.text, marginBottom: 8 }}>
            Sign In Required
          </Typography>
          <Typography style={{ fontSize: '0.875rem', color: c.textSecondary, marginBottom: 24 }}>
            Please sign in with your Google account to authorize this device.
          </Typography>
          {error && <ErrorAlert message={error} />}
          <Button
            variant="contained" color="primary" fullWidth size="large"
            onClick={handleSignIn}
            disabled={loading}
            aria-label="Sign in with Google"
          >
            {loading ? (
              <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CircularProgress size={16} style={{ color: 'inherit' }} />
                Signing in...
              </Box>
            ) : 'Sign in with Google'}
          </Button>
          <Typography style={{ fontSize: '0.75rem', color: c.textMuted, marginTop: 20 }}>
            You'll be redirected to Google to sign in, then returned here to enter your device code.
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.bg, padding: 16 }}>
      <Box style={card}>
        <p style={sectionLabel}>Device Authorization</p>
        <Typography style={{ fontSize: '1.25rem', fontWeight: 600, color: c.text, marginBottom: 8 }}>
          Authorize Device
        </Typography>
        <Typography style={{ fontSize: '0.875rem', color: c.textSecondary, marginBottom: 24 }}>
          Enter the code displayed in your terminal to authorize this device.
        </Typography>
        <form onSubmit={handleSubmit} noValidate>
          <TextField
            fullWidth variant="outlined" size="small"
            placeholder="XXXX-XXXX"
            value={code}
            onChange={handleCodeChange}
            disabled={loading}
            inputProps={{
              maxLength: 9,
              'aria-label': 'Device authorization code',
              style: {
                textAlign: 'center',
                fontSize: '1.375rem',
                letterSpacing: '0.2em',
                fontFamily: '"Geist Mono", monospace',
                textTransform: 'uppercase',
                padding: '12px 14px',
                color: c.text,
              },
            }}
            InputProps={{ style: { height: 'auto' } }}
            style={{ marginBottom: 20 }}
          />
          {error && <ErrorAlert message={error} />}
          <Button
            type="submit" variant="contained" color="primary" fullWidth size="large"
            disabled={!code || loading}
            aria-label="Authorize device"
          >
            {loading ? (
              <Box style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CircularProgress size={16} style={{ color: 'inherit' }} />
                Authorizing...
              </Box>
            ) : 'Authorize Device'}
          </Button>
        </form>
        <Typography style={{ fontSize: '0.75rem', color: c.textMuted, marginTop: 20 }}>
          If you didn't request this authorization, you can safely close this page.
        </Typography>
      </Box>
    </Box>
  );
};
