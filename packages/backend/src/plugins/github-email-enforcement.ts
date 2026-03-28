/**
 * Custom GitHub auth module: enforces @stratpoint.com email verification.
 *
 * Behavior:
 * - Uses the GitHub OAuth access token to call /user/emails (includes private emails)
 * - Rejects sign-in if the GitHub account has no verified @stratpoint.com email
 * - On success: attempts catalog sign-in by GitHub login name annotation
 *
 * This module REPLACES @backstage/plugin-auth-backend-module-github-provider in index.ts.
 */
import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import {
  authProvidersExtensionPoint,
  createOAuthProviderFactory,
} from '@backstage/plugin-auth-node';
import { githubAuthenticator } from '@backstage/plugin-auth-backend-module-github-provider';
import { userStoreReady } from '@stratpoint/plugin-user-management-backend';

interface GitHubEmail {
  email: string;
  verified: boolean;
  primary: boolean;
  visibility: string | null;
}

async function getVerifiedOrgEmail(
  accessToken: string,
  domain: string,
): Promise<string | null> {
  const res = await fetch('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
    },
  });

  if (!res.ok) {
    throw new Error(
      `GitHub /user/emails returned ${res.status}: ${await res.text()}`,
    );
  }

  const emails = (await res.json()) as GitHubEmail[];
  const match = emails.find(
    e => e.verified && e.email.endsWith(`@${domain}`),
  );
  return match?.email ?? null;
}

export const githubEmailEnforcementModule = createBackendModule({
  pluginId: 'auth',
  moduleId: 'github-email-enforcement',
  register(reg) {
    reg.registerInit({
      deps: {
        providers: authProvidersExtensionPoint,
        config: coreServices.rootConfig,
      },
      async init({ providers, config }) {
        const domain = config.getString('organization.domain');
        providers.registerProvider({
          providerId: 'github',
          factory: createOAuthProviderFactory({
            authenticator: githubAuthenticator,
            additionalScopes: ['user:email'],
            async signInResolver(info, ctx) {
              const accessToken = info.result.session.accessToken;

              // Verify the GitHub account has a verified org email.
              // /user/emails includes private emails — more reliable than profile.email.
              const orgEmail = await getVerifiedOrgEmail(accessToken, domain);

              if (!orgEmail) {
                throw new Error(
                  `Your GitHub account does not have a verified @${domain} email address. ` +
                    `Please add your @${domain} email to your GitHub account and verify it, then try again.`,
                );
              }

              // Derive entity name from the org email local part
              // e.g., john.doe@example.com → user:default/john.doe
              const localPart = orgEmail.split('@')[0];
              const entityRef = `user:default/${localPart}`;

              // Persist the GitHub username so the onboarding step resolves immediately.
              // Non-fatal — if the user isn't in the DB yet (shouldn't happen) we continue.
              const githubLogin = (info.result.fullProfile as any).username as string | undefined;
              if (githubLogin) {
                // Race userStoreReady against a 10-second timeout so a user-management
                // startup failure (DB migration lock, connection error, etc.) does not
                // cause this .then() callback to queue silently forever.
                const timeout = new Promise<never>((_, reject) =>
                  setTimeout(
                    () => reject(new Error('userStoreReady timeout — user-management plugin did not initialize within 10s')),
                    10_000,
                  ),
                );
                Promise.race([userStoreReady, timeout])
                  .then(store => store.updateGithubUsername(localPart, githubLogin, domain))
                  .catch(err => {
                    console.warn(`[github-email-enforcement] updateGithubUsername failed for ${localPart}:`, err);
                  });
              }

              // Try catalog sign-in — if the user entity exists, return full identity
              try {
                return await ctx.signInWithCatalogUser({ entityRef });
              } catch {
                // User exists in Backstage via Google login but hasn't been assigned a team yet.
                // Issue token with general-engineers membership — same fallback as Google provider.
                return ctx.issueToken({
                  claims: {
                    sub: entityRef,
                    ent: [entityRef, 'group:default/general-engineers'],
                  },
                });
              }
            },
          }),
        });
      },
    });
  },
});

export default githubEmailEnforcementModule;
