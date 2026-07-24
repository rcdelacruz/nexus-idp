/**
 * Identity helpers shared between the HTTP router and the agent routes.
 *
 * Task and agent rows are keyed on user *email* (`user_id`), while Backstage credentials
 * carry a user *entity reference*. Both call sites need the same translation, so it lives
 * here rather than being duplicated.
 */

/**
 * The org email domain used to build an email from a bare username. Config-driven (never
 * hardcode an org-specific domain) — reuses the auth allowed-domains config, first entry.
 * Falls back to `localhost` only if nothing is configured.
 */
export function emailDomain(): string {
  const configured =
    process.env.AGENT_EMAIL_DOMAIN ||
    process.env.AUTH_GOOGLE_ALLOWED_DOMAINS?.split(',')[0]?.trim();
  return configured || 'localhost';
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
