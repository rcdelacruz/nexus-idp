import React from 'react';
import { Grid, Typography, Button } from '@material-ui/core';
import { InfoCard } from '@backstage/core-components';
import { ShieldOff } from 'lucide-react';
import { useColors, semantic } from '@stratpoint/theme-utils';

type PermissionDeniedPageProps = {
  requiredPermission?: string;
};

export const PermissionDeniedPage = ({ requiredPermission }: PermissionDeniedPageProps) => {
  const c = useColors();

  return (
    <Grid container justifyContent="center" alignItems="center" style={{ padding: 32 }}>
      <Grid item xs={12} sm={8} md={6}>
        <InfoCard>
          <Grid container direction="column" alignItems="center" spacing={2}>
            <Grid item>
              <ShieldOff size={48} strokeWidth={1.5} color={semantic.error} style={{ marginBottom: 16 }} />
            </Grid>
            <Grid item>
              <Typography style={{ fontSize: '1.25rem', fontWeight: 600, color: c.text, marginBottom: 8 }}>
                Permission Denied
              </Typography>
            </Grid>
            <Grid item>
              <Typography style={{ fontSize: '0.875rem', color: c.textSecondary, textAlign: 'center', marginBottom: 16 }}>
                You don't have the required permission to access this page.
                {requiredPermission && (
                  <>
                    <br /><br />
                    Required permission: <code style={{ fontSize: '0.8125rem', color: c.text }}>{requiredPermission}</code>
                  </>
                )}
              </Typography>
            </Grid>
            <Grid item>
              <Button variant="contained" color="primary" href="/">
                Go to Home
              </Button>
            </Grid>
          </Grid>
        </InfoCard>
      </Grid>
    </Grid>
  );
};
