import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  Paper,
  CircularProgress,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { makeStyles } from '@material-ui/core/styles';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import { useApi, googleAuthApiRef, identityApiRef, discoveryApiRef } from '@backstage/core-plugin-api';

const useStyles = makeStyles(theme => ({
  root: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: theme.spacing(2),
  },
  paper: {
    padding: theme.spacing(4),
    maxWidth: 500,
    width: '100%',
    textAlign: 'center',
  },
  title: {
    marginBottom: theme.spacing(2),
    fontWeight: 600,
  },
  subtitle: {
    marginBottom: theme.spacing(3),
    color: theme.palette.text.secondary,
  },
  codeInput: {
    marginBottom: theme.spacing(3),
    '& input': {
      textAlign: 'center',
      fontSize: '1.5rem',
      letterSpacing: '0.2em',
      fontFamily: 'monospace',
      textTransform: 'uppercase',
    },
  },
  button: {
    marginTop: theme.spacing(2),
    padding: theme.spacing(1.5),
  },
  successIcon: {
    fontSize: 64,
    color: theme.palette.success.main,
    marginBottom: theme.spacing(2),
  },
}));

export const DeviceAuthPage = () => {
  const classes = useStyles();
  const googleAuthApi = useApi(googleAuthApiRef);
  const identityApi = useApi(identityApiRef);
  const discoveryApi = useApi(discoveryApiRef);

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Check authentication status
  useEffect(() => {
    const checkAuth = async () => {
      try {
        await identityApi.getBackstageIdentity();
        setIsAuthenticated(true);
        setCheckingAuth(false);

        // If we have oauth-redirect stored, we just came back from OAuth
        const redirectPath = sessionStorage.getItem('oauth-redirect');
        if (redirectPath === '/device') {
          sessionStorage.removeItem('oauth-redirect');
        }
      } catch (err) {
        setIsAuthenticated(false);
        setCheckingAuth(false);
      }
    };

    checkAuth();
  }, [identityApi]);

  const handleSignIn = async () => {
    try {
      setLoading(true);
      // Store current URL before OAuth
      sessionStorage.setItem('oauth-redirect', window.location.pathname);

      await googleAuthApi.getAccessToken(['openid', 'profile', 'email']);

      // After OAuth completes, check if we're back on the right page
      const redirectPath = sessionStorage.getItem('oauth-redirect');
      if (redirectPath && window.location.pathname !== redirectPath) {
        window.location.href = redirectPath;
        return;
      }

      sessionStorage.removeItem('oauth-redirect');

      // Refresh auth state
      await identityApi.getBackstageIdentity();
      setIsAuthenticated(true);
      setError('');
    } catch (err: any) {
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
      // Get Backstage auth token
      const { token } = await identityApi.getCredentials();

      // Get proper backend URL for local-provisioner plugin
      const baseUrl = await discoveryApi.getBaseUrl('local-provisioner');
      const apiUrl = `${baseUrl}/agent/device/authorize`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`, // CRITICAL: Backstage auth token
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
    const value = event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
    setCode(value);
  };

  // Show loading while checking authentication
  if (checkingAuth) {
    return (
      <Box className={classes.root}>
        <Paper className={classes.paper}>
          <CircularProgress size={64} style={{ marginBottom: 16 }} />
          <Typography variant="h5" className={classes.title}>
            Checking authentication...
          </Typography>
          <Typography variant="body2" color="textSecondary">
            If not logged in, you'll be redirected to Google sign-in
          </Typography>
        </Paper>
      </Box>
    );
  }

  if (success) {
    return (
      <Box className={classes.root}>
        <Paper className={classes.paper}>
          <CheckCircleIcon className={classes.successIcon} />
          <Typography variant="h4" className={classes.title}>
            Device Authorized!
          </Typography>
          <Typography variant="body1" className={classes.subtitle}>
            You can now close this window and return to your terminal.
          </Typography>
          <Typography variant="body2" color="textSecondary">
            Your Backstage agent is now authenticated and ready to use.
          </Typography>
        </Paper>
      </Box>
    );
  }

  // Show sign-in prompt if not authenticated
  if (!isAuthenticated) {
    return (
      <Box className={classes.root}>
        <Paper className={classes.paper}>
          <Typography variant="h4" className={classes.title}>
            Sign In Required
          </Typography>
          <Typography variant="body1" className={classes.subtitle}>
            Please sign in with your Google account to authorize this device.
          </Typography>

          {error && (
            <Alert severity="error" style={{ marginBottom: 16 }}>
              {error}
            </Alert>
          )}

          <Button
            variant="contained"
            color="primary"
            fullWidth
            size="large"
            onClick={handleSignIn}
            disabled={loading}
            className={classes.button}
          >
            {loading ? (
              <>
                <CircularProgress size={24} style={{ marginRight: 8 }} />
                Signing in...
              </>
            ) : (
              'Sign in with Google'
            )}
          </Button>

          <Box mt={3}>
            <Typography variant="caption" color="textSecondary">
              You'll be redirected to Google to sign in, then returned here to enter your device code.
            </Typography>
          </Box>
        </Paper>
      </Box>
    );
  }

  return (
    <Box className={classes.root}>
      <Paper className={classes.paper}>
        <Typography variant="h4" className={classes.title}>
          Authorize Device
        </Typography>
        <Typography variant="body1" className={classes.subtitle}>
          Enter the code displayed in your terminal to authorize this device.
        </Typography>

        <form onSubmit={handleSubmit}>
          <TextField
            fullWidth
            variant="outlined"
            placeholder="XXXX-XXXX"
            value={code}
            onChange={handleCodeChange}
            className={classes.codeInput}
            disabled={loading}
            autoFocus
            inputProps={{
              maxLength: 9,
              'aria-label': 'Device authorization code',
            }}
          />

          {error && (
            <Alert severity="error" style={{ marginBottom: 16 }}>
              {error}
            </Alert>
          )}

          <Button
            type="submit"
            variant="contained"
            color="primary"
            fullWidth
            size="large"
            disabled={!code || loading}
            className={classes.button}
          >
            {loading ? (
              <>
                <CircularProgress size={24} style={{ marginRight: 8 }} />
                Authorizing...
              </>
            ) : (
              'Authorize Device'
            )}
          </Button>
        </form>

        <Box mt={3}>
          <Typography variant="caption" color="textSecondary">
            If you didn't request this authorization, you can safely close this page.
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
};
