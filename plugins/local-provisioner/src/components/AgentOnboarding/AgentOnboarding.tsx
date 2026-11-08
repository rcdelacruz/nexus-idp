import { getColors } from '@stratpoint/theme-utils';
import React, { useState } from 'react';
import { InfoCard } from '@backstage/core-components';
import { Box, Typography, IconButton, Tooltip, makeStyles } from '@material-ui/core';
import { Copy, Check, Terminal, Download, LogIn, Play, Container } from 'lucide-react';
import { DOCKER_DESKTOP_URL, DOCKER_ENGINE_URL, MULTIPASS_URL } from '../AgentRequirements';

// Terminal-style blocks are dark in every theme.
const TERMINAL = getColors(true);

const useStyles = makeStyles(theme => ({
  intro: { fontSize: '0.8125rem', color: theme.palette.text.secondary, marginBottom: theme.spacing(2) },
  step: { display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: theme.spacing(2) },
  stepIcon: { color: theme.palette.text.secondary, marginTop: 2, flexShrink: 0 },
  stepTitle: { fontSize: '0.8125rem', fontWeight: 600, marginBottom: 4 },
  cmd: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: TERMINAL.surface,
    color: TERMINAL.text,
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    borderRadius: 6,
    padding: theme.spacing(0.75, 1.25),
  },
  cmdText: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cmdWrap: { flex: 1, whiteSpace: 'normal', wordBreak: 'break-all' },
  note: { fontSize: '0.75rem', color: theme.palette.text.secondary, marginTop: theme.spacing(1) },
}));

function Command({ text, wrap }: { text: string; wrap?: boolean }) {
  const classes = useStyles();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className={classes.cmd}>
      <span className={wrap ? classes.cmdWrap : classes.cmdText} title={text}>
        {text}
      </span>
      <Tooltip title={copied ? 'Copied' : 'Copy'}>
        <IconButton size="small" onClick={copy} aria-label="copy command" style={{ color: TERMINAL.textSecondary }}>
          {copied ? <Check size={14} strokeWidth={2} color="#079669" /> : <Copy size={14} strokeWidth={1.5} />}
        </IconButton>
      </Tooltip>
    </div>
  );
}

const PORTAL_URL =
  typeof window !== 'undefined' ? window.location.origin : 'https://your-backstage-instance';

/** The installer the backend serves (public, plain text: open the address in a browser to read it first). */
const INSTALL_COMMAND = `curl -fsSL ${PORTAL_URL}/api/local-provisioner/agent/install.sh | sh`;

/**
 * Zero-agent onboarding: install → login → start, with copy-able commands. Shown when the user
 * has no registered agent, so provisioning is never a dead end.
 */
export const AgentOnboarding = () => {
  const classes = useStyles();
  return (
    <InfoCard title="Set up your agent">
      <Typography className={classes.intro}>
        The agent runs on your machine and provisions resources locally via Docker. Set it up once, then log in.
      </Typography>

      <div className={classes.step}>
        <Container size={16} strokeWidth={1.5} className={classes.stepIcon} />
        <Box flex={1}>
          <div className={classes.stepTitle}>1. Install Docker Desktop (recommended)</div>
          <Typography className={classes.note}>
            The agent runs your labs in Docker and will not start until Docker is open and says it is running.{' '}
            <a href={DOCKER_DESKTOP_URL} target="_blank" rel="noopener noreferrer">
              Get Docker Desktop
            </a>{' '}
            (macOS, Windows) or{' '}
            <a href={DOCKER_ENGINE_URL} target="_blank" rel="noopener noreferrer">
              Docker Engine
            </a>{' '}
            (Linux). The Linux server labs also need{' '}
            <a href={MULTIPASS_URL} target="_blank" rel="noopener noreferrer">
              Multipass
            </a>
            .
          </Typography>
        </Box>
      </div>

      <div className={classes.step}>
        <Download size={16} strokeWidth={1.5} className={classes.stepIcon} />
        <Box flex={1}>
          <div className={classes.stepTitle}>2. Install the agent (macOS, Linux; needs Node 20+)</div>
          <Command wrap text={INSTALL_COMMAND} />
          <Typography className={classes.note}>
            Then open a new terminal window. The installer makes <code>backstage-agent</code> work in every terminal, whichever Node
            version it uses. On Windows: <code>npm install -g @stratpoint/backstage-agent</code>.
          </Typography>
        </Box>
      </div>

      <div className={classes.step}>
        <LogIn size={16} strokeWidth={1.5} className={classes.stepIcon} />
        <Box flex={1}>
          <div className={classes.stepTitle}>3. Log in (opens your browser)</div>
          <Command text={`backstage-agent login --url ${PORTAL_URL}`} />
        </Box>
      </div>

      <div className={classes.step}>
        <Play size={16} strokeWidth={1.5} className={classes.stepIcon} />
        <Box flex={1}>
          <div className={classes.stepTitle}>4. Start the agent</div>
          <Command text="backstage-agent start" />
          <Typography className={classes.note}>If Docker is not ready, this tells you what to fix.</Typography>
        </Box>
      </div>

      <div className={classes.step}>
        <Terminal size={16} strokeWidth={1.5} className={classes.stepIcon} />
        <Box flex={1}>
          <div className={classes.stepTitle}>Offline?</div>
          <Typography className={classes.note}>
            Once a resource is provisioned it runs with no internet. Manage it offline with{' '}
            <code>backstage-agent resources</code> and{' '}
            <code>backstage-agent resource stop|start|logs &lt;name&gt;</code>.
          </Typography>
        </Box>
      </div>
    </InfoCard>
  );
};
