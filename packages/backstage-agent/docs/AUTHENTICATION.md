# Backstage Agent Authentication Flow

This document explains how the Backstage Agent authenticates with the Backstage backend using Google OAuth.

## Overview

The agent uses a **browser-based OAuth flow with manual token entry**. This approach works around Backstage's popup/iframe OAuth pattern and provides a secure, user-friendly authentication experience.

## Authentication Flow Diagram

```
┌─────────────┐                ┌──────────────┐                ┌─────────────┐
│             │                │              │                │             │
│  CLI Agent  │                │  Backstage   │                │   Google    │
│             │                │   Backend    │                │    OAuth    │
└──────┬──────┘                └──────┬───────┘                └──────┬──────┘
       │                              │                               │
       │  1. backstage-agent login    │                               │
       ├──────────────────────────────>                               │
       │                              │                               │
       │  2. Open browser             │                               │
       │     /agent/auth-start        │                               │
       ├─────────────────────────────>│                               │
       │                              │                               │
       │  3. Redirect to Google OAuth │                               │
       │                              ├──────────────────────────────>│
       │                              │                               │
       │                              │  4. User authenticates        │
       │                              │<──────────────────────────────┤
       │                              │                               │
       │  5. Redirect to /auth-callback                              │
       │     (with authenticated session)                             │
       │                              │                               │
       │  6. Generate service token   │                               │
       │                              │                               │
       │  7. Display token in browser │                               │
       │<─────────────────────────────┤                               │
       │                              │                               │
       │  8. User copies token        │                               │
       │     manually                 │                               │
       │                              │                               │
       │  9. Paste token in CLI       │                               │
       │                              │                               │
       │  10. Store token in          │                               │
       │      ~/.backstage-agent/     │                               │
       │                              │                               │
       │  11. Use token for API calls │                               │
       ├─────────────────────────────>│                               │
       │      (Authorization: Bearer) │                               │
       │                              │                               │
```

## Step-by-Step Process

### 1. User Initiates Login

```bash
backstage-agent login --url http://localhost:7007
```

### 2. CLI Opens Browser

The CLI opens the browser to the **auth start endpoint**:

```
http://localhost:7007/api/local-provisioner/agent/auth-start
```

This endpoint is **public** (no authentication required).

### 3. Backend Redirects to Google OAuth

The `/agent/auth-start` endpoint redirects to Backstage's Google OAuth flow:

```
/api/auth/google/start?redirect=/api/local-provisioner/agent/auth-callback
```

### 4. User Authenticates with Google

User signs in with their Google account. Backstage validates the email domain (@stratpoint.com).

### 5. OAuth Callback

After successful authentication, Backstage redirects to our custom callback:

```
/api/local-provisioner/agent/auth-callback
```

**Important**: At this point, the user is **authenticated** (session cookie set), so `req.user` contains their Backstage identity.

### 6. Token Generation

The `/agent/auth-callback` endpoint:

1. Verifies user is authenticated (`req.user.userEntityRef`)
2. Calls `agentService.authenticateAgent()` to generate a service token
3. Returns a **beautiful HTML page** displaying:
   - Agent ID
   - Service token (in a copyable text box)
   - Copy to clipboard button
   - Instructions for next steps

### 7. User Copies Token

User clicks "Copy Token to Clipboard" or manually selects the token text.

### 8. User Pastes Token in CLI

CLI prompts:

```
Paste the agent token here: _
```

User pastes the token and presses Enter.

### 9. Token Stored Locally

CLI stores the token in:

```
~/.backstage-agent/config.json
```

Format:
```json
{
  "backstageUrl": "http://localhost:7007",
  "serviceToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "agentId": "agent-12345"
}
```

### 10. Future API Calls

All subsequent API calls include the token:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## Security Considerations

### Why This Flow is Secure

1. **OAuth Authentication**: User authenticates via Google OAuth (industry standard)
2. **Domain Restriction**: Only @stratpoint.com emails allowed
3. **No Token in URL**: Token is displayed in HTML, not passed via URL parameters
4. **HTTPS in Production**: Token transmitted over encrypted connection
5. **Secure Storage**: Token stored in user's home directory with restricted permissions
6. **Token Expiration**: Tokens have configurable expiration (default: 30 days)
7. **User Scoping**: Token tied to specific user identity

### Token Format

Service tokens are JWTs (JSON Web Tokens) signed with `BACKEND_SECRET`:

```json
{
  "sub": "user:default/john.doe",
  "agentId": "agent-12345",
  "iat": 1703001600,
  "exp": 1705680000
}
```

### Permission Model

Agents inherit the permissions of the user who authenticated:

- **Regular Users**: Can provision resources for themselves
- **Admins** (`backstage-admins` group): Can provision for any user/team

## Alternative Flows Considered

### 1. Device Code Flow (OAuth 2.0)

**Pros**: Standard OAuth pattern for CLI tools

**Cons**:
- Requires custom OAuth provider in Backstage
- More complex implementation
- Not supported by Backstage's built-in Google provider

### 2. Local Callback Server

**Pros**: Fully automated (no manual copy/paste)

**Cons**:
- Doesn't work with Backstage's popup/iframe OAuth flow
- Requires open port on user's machine
- Firewall/network issues

### 3. API Keys

**Pros**: Simple implementation

**Cons**:
- No user identity (would need separate user management)
- Less secure (no OAuth)
- Manual provisioning required

### 4. Service-to-Service Tokens

**Pros**: Built-in Backstage pattern

**Cons**:
- Requires backend service account, not suitable for user agents
- No user identity/permissions
- Not designed for CLI tools

## Why We Chose Manual Token Entry

1. **Works with Backstage's OAuth**: No need to modify Backstage's auth flow
2. **User Identity**: Tokens tied to real user accounts with RBAC
3. **Simple Implementation**: Minimal backend changes
4. **Secure**: Uses existing Google OAuth + JWT tokens
5. **Good UX**: Browser shows clear instructions with copy button
6. **Cross-platform**: Works on all OSes without network dependencies

## Troubleshooting

### Token Doesn't Work

**Symptom**: API calls return 401 Unauthorized

**Solutions**:
1. Check token hasn't expired: `backstage-agent whoami`
2. Re-authenticate: `backstage-agent login`
3. Verify Backstage backend is running
4. Check `BACKEND_SECRET` hasn't changed

### Browser Doesn't Open

**Symptom**: Browser fails to open automatically

**Solutions**:
1. Manually open the URL shown in terminal
2. Check browser is installed and in PATH
3. Use different browser: `BROWSER=firefox backstage-agent login`

### Authentication Fails in Browser

**Symptom**: Google OAuth shows error

**Solutions**:
1. Verify email domain is @stratpoint.com
2. Check user exists in `stratpoint/org/users.yaml`
3. Verify Google OAuth credentials in `.env`

## Future Enhancements

### Phase 4 Improvements

1. **QR Code Display**: Show QR code in terminal for mobile auth
2. **Token Refresh**: Auto-refresh expired tokens
3. **Multi-Agent**: Support multiple agents per user
4. **MFA Support**: Add multi-factor authentication option
5. **Audit Logging**: Log all token generation events
6. **Token Revocation**: CLI command to invalidate tokens

### Long-Term Considerations

1. **SSO Integration**: Support SAML/OIDC for enterprise SSO
2. **Hardware Tokens**: Support YubiKey/hardware tokens
3. **Biometric Auth**: Support TouchID/Windows Hello
4. **Zero-Trust**: Integrate with device trust platforms

## References

- [OAuth 2.0 RFC](https://datatracker.ietf.org/doc/html/rfc6749)
- [Backstage Authentication](https://backstage.io/docs/auth/)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)
- [CLI OAuth Patterns](https://www.oauth.com/oauth2-servers/device-flow/)
