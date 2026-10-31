import React, { useEffect, useState } from 'react';
import { configApiRef, discoveryApiRef, fetchApiRef, useApi } from '@backstage/core-plugin-api';
import { Box, Typography } from '@material-ui/core';
import { Calendar, GitCommitHorizontal, Layers, Tag, type LucideIcon } from 'lucide-react';
import { useColors, borderRadius } from '@stratpoint/theme-utils';
import { formatBuildDate, parseGitVersion, readBuildInfo } from './buildInfo';

const UNKNOWN = 'unknown';

/**
 * Which published release contains this build's commit, asked when the page opens (backend
 * `release-info`). The build-time tag (`git describe`) can't know about a release tagged after
 * the deploy; undefined until answered, or when GitHub can't be reached.
 */
function useRelease(commit: string | null): { includedIn?: string; after?: string } | undefined {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);
  const [release, setRelease] = useState<{ includedIn?: string; after?: string }>();
  useEffect(() => {
    if (!commit) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const base = await discoveryApi.getBaseUrl('release-info');
        const res = await fetchApi.fetch(`${base}/release?commit=${encodeURIComponent(commit)}`);
        if (res.ok && !cancelled) setRelease(await res.json());
      } catch {
        // keep the build-time tag
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commit, discoveryApi, fetchApi]);
  return release;
}

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
  mono,
  title,
  last,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
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
    </Box>
  );
};

export function AboutTab() {
  const config = useApi(configApiRef);
  const c = useColors();

  const backstageVersion = config.getOptionalString('app.backstage.version') ?? UNKNOWN;
  const build = readBuildInfo();
  // Nearest tag only; how far the build is past it is deliberately not shown — the Commit row
  // identifies the exact build.
  const { tag } = parseGitVersion(build?.gitVersion);
  const commit = build && build.commit !== UNKNOWN ? build.commit : null;
  const release = useRelease(commit);
  let releaseValue = tag ?? UNKNOWN;
  let releaseTitle = "Nearest release tag in the build's git history";
  if (release?.includedIn) {
    releaseValue = release.includedIn;
    releaseTitle = 'The published release that includes this build';
  } else if (release?.after) {
    // The release only, like the build-time tag: how far a build is past it was dropped on
    // purpose (2026-10-29) — the Commit row identifies the exact build.
    releaseValue = release.after;
    releaseTitle = `Latest release this build is based on (${release.after})`;
  }
  const builtAt =
    build && Number.isFinite(build.timestamp)
      ? formatBuildDate(build.timestamp)
      : UNKNOWN;

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
            value={releaseValue}
            title={releaseTitle}
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
