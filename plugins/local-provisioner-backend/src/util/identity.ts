/**
 * Identity helpers shared between the HTTP router and the agent routes.
 *
 * Task and agent rows are keyed on user *email* (`user_id`), while Backstage credentials
 * carry a user *entity reference*. Both call sites need the same translation, so it lives
 * here rather than being duplicated.
 */

import { Config } from '@backstage/config';

/**
 * The org email domain used to build an email from a bare username. Resolved once from
 * configuration at plugin init (see `resolveEmailDomainFromConfig` + `setEmailDomain`) so we
 * never hardcode an org-specific domain in source. `emailDomain()` reads the resolved value.
 */
let configuredDomain: string | undefined;

/**
 * Resolve the org email domain from configuration. Called once at plugin init.
 *
 * Priority:
 *   1. `AGENT_EMAIL_DOMAIN` env var (explicit override)
 *   2. the first `auth.providers.google.<env>.allowedDomains` entry — the deployment's real
 *      sign-in domain, which is exactly the domain a bare username belongs to
 *
 * Returns `undefined` when nothing is configured; callers then fall back to `localhost`.
 * Never hardcode an org-specific domain here — this keeps the module white-label clean.
 */
export function resolveEmailDomainFromConfig(config: Config): string | undefined {
  const envDomain = process.env.AGENT_EMAIL_DOMAIN?.trim();
  if (envDomain) {
    return envDomain;
  }

  const google = config.getOptionalConfig('auth.providers.google');
  if (google) {
    for (const envKey of google.keys()) {
      const domains = google
        .getOptionalConfig(envKey)
        ?.getOptionalStringArray('allowedDomains');
      if (domains && domains.length > 0) {
        return domains[0];
      }
    }
  }

  return undefined;
}

/**
 * Store the resolved org email domain. Call once at plugin init, before any request is served.
 */
export function setEmailDomain(domain: string | undefined): void {
  configuredDomain = domain;
}

/**
 * The resolved org email domain, or `localhost` if none was configured. `localhost` is a safe,
 * consistent placeholder — it keeps identity stable rather than defaulting to any real org.
 */
export function emailDomain(): string {
  return (
    configuredDomain ||
    process.env.AGENT_EMAIL_DOMAIN?.trim() ||
    process.env.AUTH_GOOGLE_ALLOWED_DOMAINS?.split(',')[0]?.trim() ||
    'localhost'
  );
}

/**
 * Convert a Backstage user entity reference to an email address.
 *
 * `user:default/jane.doe` -> `jane.doe@<configured-domain>`
 * `user:default/someone@example.com` -> `someone@example.com`
 *
 * @throws if the reference is not in `<kind>:<namespace>/<name>` form.
 */
export function extractEmailFromEntityRef(entityRef: string): string {
  const parts = entityRef.split('/');
  if (parts.length !== 2) {
    throw new Error(`Invalid user entity reference: ${entityRef}`);
  }

  const username = parts[1];

  // If already an email, return as-is
  if (username.includes('@')) {
    return username;
  }

  // Otherwise, append the configured org domain
  return `${username}@${emailDomain()}`;
}
