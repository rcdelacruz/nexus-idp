# Backstage Agent Authentication

The agent authenticates using the **OAuth 2.0 Device Authorization Grant (RFC 8628)** — the
same pattern as `gh auth login` and `aws sso login`.

> **Note:** an earlier design used a manual browser copy/paste flow via `/agent/auth-start`
> and `/agent/auth-callback`. Those endpoints were **removed on 2026-07-24** — they minted
> tokens under a hardcoded identity rather than the signed-in user. The device flow below is
> the only supported path.

## Why the device flow

A CLI cannot host an OAuth redirect URI, and asking users to copy a token out of a browser is
both awkward and easy to get wrong. The device grant solves this: the browser does the
authenticating, the CLI polls for the outcome, and no secret is displayed for the user to
handle manually.

## The flow

```
  CLI                          Portal backend                    Browser
   │                                 │                              │
   │  POST /agent/device/code        │                              │
   ├────────────────────────────────►│                              │
   │  { device_code, user_code }     │                              │
   │◄────────────────────────────────┤                              │
   │                                 │                              │
   │  prints user_code (ABCD-1234)   │                              │
   │  and opens browser              ├─────────────────────────────►│
   │                                 │      user enters code,       │
   │                                 │      signs in with Google    │
   │                                 │                              │
   │                                 │◄─ POST /agent/device/authorize
   │                                 │   (authenticated — identity  │
   │                                 │    established here)         │
   │  POST /agent/device/token       │                              │
   ├────────────────────────────────►│  (polled until authorized)   │
   │  { access_token, agent_id }     │                              │
   │◄────────────────────────────────┤                              │
   │                                 │                              │
   │  POST /agent/register           │                              │
   ├────────────────────────────────►│  machine info → agent record │
   │                                 │                              │
   │  saves ~/.backstage-agent/config.json                          │
```

**Implementation:** `src/auth/GoogleAuthClient.ts` (`startOAuthFlow`, `registerAgent`),
driven by `src/commands/login.ts`.

## Token handling

| Property | Value |
|---|---|
| Storage | `~/.backstage-agent/config.json` |
| Lifetime | 7 days |
| Transport | `Authorization: Bearer <token>` on every agent request |
| Renewal | Re-run `backstage-agent login` |

Device codes expire after 10 minutes. `POST /agent/device/code` and
`POST /agent/device/token` are rate limited, since they are necessarily unauthenticated.

> ⚠️ The token is currently an **opaque bearer string, not a signed JWT**. It should not be
> treated as an authorization boundary. Hardening this is tracked internally as a breaking
> change — it invalidates every installed agent's stored token.

## Identity

Real user identity is established at `POST /agent/device/authorize`, which requires an
authenticated Backstage session. The agent record is keyed on machine identity
(`hostname` + `user_id`), so re-running `login` on the same machine re-attaches to the
existing agent rather than creating a duplicate.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Device code expired` | Took longer than 10 minutes | Re-run `backstage-agent login` |
| `401` on agent calls | Token older than 7 days | Re-run `backstage-agent login` |
| Browser doesn't open | Headless/SSH session | Open the printed URL manually and enter the code |
| Registration fails | Backend schema or connectivity | Check backend logs; see the architecture doc |

## References

- [Local Provisioner Architecture](../../../docs/content/local-provisioner-architecture.md)
- [RFC 8628 — OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)
