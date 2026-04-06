# Google OAuth Setup

Nexus IDP uses Google OAuth to authenticate users. Sign-in is restricted to `@stratpoint.com` accounts. There is no Google Workspace sync — users are managed in the Backstage database after their first sign-in.

## How It Works

1. User clicks "Sign in with Google" on the portal
2. Google redirects back with an OAuth token
3. The `google-auto-provision` backend module validates the email domain
4. If the email is not `@stratpoint.com`, sign-in is rejected
5. If the user exists in the catalog → full sign-in with correct group memberships
6. If the user is new → token issued with `general-engineers` membership → redirected to `/onboarding`

## Required Google Cloud Configuration

### Step 1: Create OAuth 2.0 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Click **Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Name: `Nexus IDP`
5. Authorized redirect URIs:
   - Development: `http://localhost:7007/api/auth/google/handler/frame`
   - Production: `https://portal.stratpoint.io/api/auth/google/handler/frame`
6. Copy the **Client ID** and **Client Secret**

### Step 2: Set Environment Variables

```bash
AUTH_GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
AUTH_GOOGLE_CLIENT_SECRET=<your-client-secret>
```

In Kubernetes, add these to the `backstage-secrets` secret:
```bash
kubectl create secret generic backstage-secrets -n backstage \
  --from-literal=AUTH_GOOGLE_CLIENT_ID=<client-id> \
  --from-literal=AUTH_GOOGLE_CLIENT_SECRET=<client-secret> \
  ...
```

### Step 3: app-config.yaml

```yaml
organization:
  domain: stratpoint.com   # Controls which email domain is allowed

auth:
  environment: production  # Use 'development' for local dev
  providers:
    google:
      production:
        clientId: ${AUTH_GOOGLE_CLIENT_ID}
        clientSecret: ${AUTH_GOOGLE_CLIENT_SECRET}
```

The `organization.domain` config is the single source of truth for the allowed email domain. It is read by both the `google-auto-provision` and `github-email-enforcement` auth modules.

## GitHub OAuth (Optional)

GitHub sign-in is also supported as an alternative to Google. The `github-email-enforcement` module:
1. Fetches the GitHub account's verified email list (including private emails)
2. Requires at least one verified `@stratpoint.com` email
3. Resolves the user entity from the org email local part (same as Google)

Required environment variables:
```bash
AUTH_GITHUB_CLIENT_ID=<github-oauth-app-client-id>
AUTH_GITHUB_CLIENT_SECRET=<github-oauth-app-client-secret>
AUTH_GITHUB_CALLBACK_URL=https://portal.stratpoint.io/api/auth/github/handler/frame
```

## Domain Restriction

The `google-auto-provision` module (`packages/backend/src/plugins/google-auto-provision.ts`) enforces domain restriction:

```typescript
if (!email?.endsWith(`@${domain}`)) {
  throw new Error(`Sign-in is restricted to @${domain} accounts`);
}
```

To change the allowed domain, update `organization.domain` in `app-config.yaml`. No code changes are needed.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Sign-in is restricted to @stratpoint.com" | User signed in with a personal Google account | User must use their `@stratpoint.com` Google account |
| Redirect URI mismatch error | Callback URL not added to OAuth app | Add the correct redirect URI in Google Cloud Console |
| `auth.environment` mismatch | Using `development` config in production | Set `auth.environment: production` in `app-config.production.yaml` |
| GitHub: "no verified @stratpoint.com email" | GitHub account doesn't have org email added | User must add and verify their `@stratpoint.com` email in GitHub settings |
