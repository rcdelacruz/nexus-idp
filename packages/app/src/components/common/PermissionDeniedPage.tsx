import React from 'react';
import { Grid, Typography, makeStyles, Button } from '@material-ui/core';
import { InfoCard } from '@backstage/core-components';
import BlockIcon from '@material-ui/icons/Block';

const useStyles = makeStyles(theme => ({
  container: {
    padding: theme.spacing(4),
  },
  icon: {
    fontSize: '4rem',
    color: theme.palette.error.main,
    marginBottom: theme.spacing(2),
  },
  title: {
    marginBottom: theme.spacing(2),
  },
  message: {
    marginBottom: theme.spacing(4),
  },
  button: {
    marginTop: theme.spacing(2),
  },
}));

type PermissionDeniedPageProps = {
  requiredPermission?: string;
};

/**
 * A page that is shown when the user doesn't have the required permission to access a route.
 */
export const PermissionDeniedPage = ({ requiredPermission }: PermissionDeniedPageProps) => {
  const classes = useStyles();

  return (
    <Grid container justifyContent="center" alignItems="center" className={classes.container}>
      <Grid item xs={12} sm={8} md={6}>
        <InfoCard>
          <Grid container direction="column" alignItems="center" spacing={2}>
            <Grid item>
              <BlockIcon className={classes.icon} />
            </Grid>
            <Grid item>
              <Typography variant="h4" className={classes.title}>
                Permission Denied
              </Typography>
            </Grid>
            <Grid item>
              <Typography variant="body1" className={classes.message}>
                You don't have the required permission to access this page.
                {requiredPermission && (
                  <>
                    <br />
                    <br />
                    Required permission: <code>{requiredPermission}</code>
                  </>
                )}
              </Typography>
            </Grid>
            <Grid item>
              <Button
                variant="contained"
                color="primary"
                href="/"
                className={classes.button}
              >
                Go to Home
              </Button>
            </Grid>
          </Grid>
        </InfoCard>
      </Grid>
    </Grid>
  );
};
