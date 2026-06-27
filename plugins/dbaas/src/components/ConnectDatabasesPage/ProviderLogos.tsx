import React, { useState } from 'react';
import { useColors, borderRadius } from '@stratpoint/theme-utils';

// Verified via GitHub API: curl https://api.github.com/orgs/<orgname> | jq '{id,login}'
const LOGO_URLS: Record<string, string> = {
  neon:        'https://avatars.githubusercontent.com/u/77690634',   // neondatabase (verified)
  supabase:    'https://avatars.githubusercontent.com/u/54469796',   // supabase (verified)
  railway:     'https://avatars.githubusercontent.com/u/66716858',   // railwayapp (verified)
  render:      'https://avatars.githubusercontent.com/u/36424661',   // renderinc (verified)
  turso:       'https://avatars.githubusercontent.com/u/139391156',  // tursodatabase (verified)
  upstash:     'https://avatars.githubusercontent.com/u/74989412',   // upstash (verified)
  atlas:       'https://avatars.githubusercontent.com/u/45120',      // mongodb (verified)
  cockroachdb: 'https://avatars.githubusercontent.com/u/6748139',   // cockroachdb (verified)
  aiven:       'https://avatars.githubusercontent.com/u/14290521',   // aiven (verified)
  planetscale: 'https://avatars.githubusercontent.com/u/35612527',   // planetscale (verified)
};

export function ProviderLogo({ providerId, size = 32 }: { providerId: string; size?: number }) {
  const c = useColors();
  const url = LOGO_URLS[providerId];
  const [imgError, setImgError] = useState(false);

  const initials = (
    <div style={{
      width: size, height: size, borderRadius: borderRadius.md,
      background: c.hoverBg,
      border: `1px solid ${c.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.35, fontWeight: 700, color: c.textSecondary,
      flexShrink: 0,
    }}>
      {providerId.slice(0, 2).toUpperCase()}
    </div>
  );

  if (!url || imgError) return initials;

  return (
    <img
      src={url}
      alt={providerId}
      width={size}
      height={size}
      style={{ borderRadius: borderRadius.md, display: 'block', objectFit: 'cover', flexShrink: 0 }}
      onError={() => setImgError(true)}
    />
  );
}
