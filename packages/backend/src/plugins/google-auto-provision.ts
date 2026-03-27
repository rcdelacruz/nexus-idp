/**
 * Custom Google auth module: auto-provisions @stratpoint.com users on first sign-in.
 *
 * Behavior:
 * - If user exists in catalog → standard sign-in with full catalog entity (correct group memberships)
 * - If user not in catalog yet → issues a token with `general-engineers` group membership
 *   so the new user can access the portal immediately, without a YAML PR on day 1.
 *   An admin/lead will later assign them to the correct department team.
 *
 * This module REPLACES @backstage/plugin-auth-backend-module-google-provider in index.ts.
 * The underlying Google OAuth authenticator (the OAuth dance itself) is still used.
 */
import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import {
  authProvidersExtensionPoint,
  createOAuthProviderFactory,
} from '@backstage/plugin-auth-node';
import { googleAuthenticator } from '@backstage/plugin-auth-backend-module-google-provider';

export const googleAutoProvisionModule = createBackendModule({
  pluginId: 'auth',
  moduleId: 'google-auto-provision',
  register(reg) {
    reg.registerInit({
      deps: {
        providers: authProvidersExtensionPoint,
        config: coreServices.rootConfig,
      },
      async init({ providers, config }) {
        const domain = config.getString('organization.domain');
        providers.registerProvider({
          providerId: 'google',
          factory: createOAuthProviderFactory({
            authenticator: googleAuthenticator,
            async signInResolver(info, ctx) {
              const email = info.profile.email;

              if (!email?.endsWith(`@${domain}`)) {
                throw new Error(
                  `Sign-in is restricted to @${domain} accounts`,
                );
              }

              // Derive entity name from email local part
              // e.g., john.doe@stratpoint.com → john.doe
              const localPart = email.split('@')[0];
              const entityRef = `user:default/${localPart}`;

              // Try catalog lookup first — existing users get proper group memberships
              try {
                return await ctx.signInWithCatalogUser({ entityRef });
              } catch {
                // User not in catalog yet — auto-provision with general-engineers
                // Admin assigns them to a department team later
                return ctx.issueToken({
                  claims: {
                    sub: entityRef,
                    ent: [
                      entityRef,
                      'group:default/general-engineers',
                    ],
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

export default googleAutoProvisionModule;
