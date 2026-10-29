import React from 'react';
import { configApiRef, useApi } from '@backstage/core-plugin-api';
import { Box, Typography } from '@material-ui/core';
import { Calendar, GitCommitHorizontal, Layers, Tag, type LucideIcon } from 'lucide-react';
import { useColors, borderRadius } from '@stratpoint/theme-utils';
import { formatBuildDate, parseGitVersion, readBuildInfo } from './buildInfo';

const UNKNOWN = 'unknown';

const SectionLabel = ({ children }: { children: React.ReactNode }) => {
  const c = useColors();
  return (
    <Typography
      style={{
        fontSize: '0.6875rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: c.textSecondary,
        marginBottom: 12,
      }}
    >
      {children}
    </Typography>
  );
};

const Row = ({
  icon: Icon,
  label,
  value,
  detail,
  mono,
  title,
  last,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail?: string;
  mono?: boolean;
  title?: string;
  last?: boolean;
}) => {
  const c = useColors();
  return (
    <Box
      display="flex"
      alignItems="center"
      style={{
        gap: 12,
        padding: '14px 0',
        borderBottom: last ? 'none' : `1px solid ${c.border}`,
      }}
    >
      <Icon size={14} strokeWidth={1.5} color={c.textSecondary} />
      <Typography style={{ fontSize: '0.875rem', color: c.textSecondary, width: 160, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography
        title={title}
        style={{
          fontSize: '0.875rem',
          fontWeight: 500,
          color: value === UNKNOWN ? c.textMuted : c.text,
          letterSpacing: '-0.006em',
          fontFamily: mono ? 'var(--font-geist-mono, ui-monospace, SFMono-Regular, Menlo, monospace)' : undefined,
        }}
      >
        {value}
      </Typography>
      {detail && (
        <Typography style={{ fontSize: '0.8125rem', color: c.textMuted }}>{detail}</Typography>
      )}
    </Box>
  );
};

export function AboutTab() {
  const config = useApi(configApiRef);
  const c = useColors();

  const backstageVersion = config.getOptionalString('app.backstage.version') ?? UNKNOWN;
  const build = readBuildInfo();
  const { tag, commitsAhead } = parseGitVersion(build?.gitVersion);
  const commit = build && build.commit !== UNKNOWN ? build.commit : null;
  const builtAt =
    build && Number.isFinite(build.timestamp)
      ? formatBuildDate(build.timestamp)
      : UNKNOWN;

  let releaseDetail: string | undefined;
  if (tag && commitsAhead > 0) {
    releaseDetail = `${commitsAhead} commit${commitsAhead === 1 ? '' : 's'} ahead`;
  }

  return (
    <Box style={{ maxWidth: 860, paddingBottom: 48 }}>
      <Typography style={{ fontSize: '0.875rem', color: c.textSecondary, lineHeight: 1.6, marginBottom: 32 }}>
        Version information for this deployment of the portal.
      </Typography>

      <Box component="section">
        <SectionLabel>Version</SectionLabel>
        <Box
          style={{
            background: c.surface,
            border: `1px solid ${c.border}`,
            borderRadius: borderRadius.lg,
            padding: '6px 20px',
          }}
        >
          <Row icon={Layers} label="Backstage" value={backstageVersion} />
          <Row
            icon={Tag}
            label="Release"
            value={tag ?? UNKNOWN}
            detail={releaseDetail}
            title="Nearest release tag in the build's git history"
          />
          <Row
            icon={GitCommitHorizontal}
            label="Commit"
            value={commit ? commit.slice(0, 7) : UNKNOWN}
            title={commit ?? undefined}
            mono
          />
          <Row icon={Calendar} label="Build date" value={builtAt} last />
        </Box>
      </Box>
    </Box>
  );
}
