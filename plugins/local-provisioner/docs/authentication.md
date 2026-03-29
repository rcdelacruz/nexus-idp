# Authentication

The Nexus Agent CLI uses the **OAuth 2.0 Device Authorization Grant** (RFC 8628) — the same flow used by GitHub CLI, AWS CLI, and similar tools.

## How It Works

```
1. Agent calls POST /agent/device/code
   → receives device_code + user_code (e.g. ABCD-1234)

2. User opens browser to /device
   → enters the user_code

3. User authenticates via Google OAuth in browser

4. Browser calls POST /agent/device/authorize with user_code

5. Agent polls POST /agent/device/token until authorized
   → receives JWT token

6. Agent saves token to ~/.backstage-agent/config.json
```

## Security

| Property | Value |
|----------|-------|
| Device code expiry | 10 minutes |
| User code format | Human-readable (33^8 combinations) |
| Device code format | Cryptographic (62^32 combinations) |
| Service token expiry | 30 days |
| Token contents | User identity for RBAC |

## Token Storage

Tokens are saved to `~/.backstage-agent/config.json`:

```json
{
  "backstageUrl": "http://localhost:7007",
  "agentId": "abc-123-xyz",
  "token": "eyJ...",
  "tokenExpiresAt": "2025-01-26T10:00:00.000Z"
}
```

## Refreshing

When the token expires, run:

```bash
backstage-agent login --url <backstage-url>
```

The agent re-authenticates through the device code flow and saves a new token.

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `POST /agent/device/code` | 10 requests per 15 minutes |
| `POST /agent/device/token` | 130 requests per 10 minutes |
