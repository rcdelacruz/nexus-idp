import React from 'react';
import { Link, Typography, makeStyles } from '@material-ui/core';
import { Container, ExternalLink, Server } from 'lucide-react';

export const DOCKER_DESKTOP_URL = 'https://www.docker.com/products/docker-desktop/';
export const DOCKER_ENGINE_URL = 'https://docs.docker.com/engine/install/';
export const MULTIPASS_URL = 'https://multipass.run/';

const useStyles = makeStyles(theme => ({
  label: {
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: theme.palette.text.secondary,
    marginBottom: theme.spacing(1),
  },
  item: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: theme.spacing(1.5) },
  icon: { color: theme.palette.text.secondary, marginTop: 2, flexShrink: 0 },
  title: { fontSize: '0.8125rem', fontWeight: 600 },
  body: { fontSize: '0.75rem', color: theme.palette.text.secondary },
  links: { display: 'flex', flexWrap: 'wrap', gap: theme.spacing(1.5), marginTop: 2, fontSize: '0.75rem' },
  link: { display: 'inline-flex', alignItems: 'center', gap: 4 },
}));

function ExternalLinkText({ href, children }: { href: string; children: React.ReactNode }) {
  const classes = useStyles();
  return (
    <Link href={href} target="_blank" rel="noopener noreferrer" className={classes.link}>
      {children}
      <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
    </Link>
  );
}

/**
 * What a machine needs before the agent can run. The agent runs labs in Docker and exits at start when Docker is
 * not ready, so Docker comes first; Multipass is only for the Linux server labs (an Ubuntu VM on your machine).
 */
export const AgentRequirements = () => {
  const classes = useStyles();
  return (
    <div data-testid="agent-requirements">
      <div className={classes.label}>Before you start</div>

      <div className={classes.item}>
        <Container size={16} strokeWidth={1.5} className={classes.icon} aria-hidden />
        <div>
          <div className={classes.title}>Docker Desktop (recommended)</div>
          <Typography className={classes.body}>
            Runs your labs. The agent will not start until Docker is open and says it is running.
          </Typography>
          <div className={classes.links}>
            <ExternalLinkText href={DOCKER_DESKTOP_URL}>Get Docker Desktop (macOS, Windows)</ExternalLinkText>
            <ExternalLinkText href={DOCKER_ENGINE_URL}>Linux: Docker Engine</ExternalLinkText>
          </div>
        </div>
      </div>

      <div className={classes.item}>
        <Server size={16} strokeWidth={1.5} className={classes.icon} aria-hidden />
        <div>
          <div className={classes.title}>Multipass (Linux server labs only)</div>
          <Typography className={classes.body}>
            Those labs are an Ubuntu VM on your machine. On macOS: <code>brew install --cask multipass</code>.
          </Typography>
          <div className={classes.links}>
            <ExternalLinkText href={MULTIPASS_URL}>Get Multipass</ExternalLinkText>
          </div>
        </div>
      </div>
    </div>
  );
};
