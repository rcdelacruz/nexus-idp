# Retro: first batch of the whole-portal security audit (2026-11-07)

**Trigger:** the Python Capstone A review found two ownership holes that were months old. Ronald asked for the whole portal to be
audited proactively instead of finding holes by chance.

**What went right**
- Auditing by attack surface (who can call it, whose object is it) found holes in six unrelated places in one pass.
- Every finding was reproduced or run before it was reported (live status of the route, the real catalog rule engine, the real MDX
  compile, a real Postgres), and every fix was mutation-tested: the deliberate breakage must make a test fail.
- The pre-commit review found six defects in the first fixes, among them a bypass of the docs fix through a second renderer.

**What to do next time**
- When a fix protects a piece of content, list EVERY renderer/consumer of that content before calling it closed (the docs viewer had
  two).
- Do not accept "the identity is trustworthy now" as the end of an auth review; ask whose object each id names.
- Heavy fan-out reviews hit the 5-hour usage limit: start fewer agents at once, write findings to a file as they land, keep prompts
  narrow.
- Test-harness traps met: a default parameter swallowing `undefined`; the test backend treating a request with no Authorization
  header as a signed-in user unless `defaultCredentials` is `none()`; the shell's interactive `cp` leaving a mutation in place
  (use `command cp -f`); `net.BlockList` treating IPv4 as IPv4-mapped IPv6; the Write tool turning `\uXXXX` escapes into literal
  characters inside a regex.

**Backlog:** kept in the internal plan `.claude/plans/security-audit-2026-11-07.md` (open items, evidence and the reviews that were
cut off). Patterns written: `token-proves-who-not-whose.md`, `outbound-fetch-ssrf-connect-time-check.md`,
`catalog-rules-judge-the-origin-location.md`, `mdx-from-untrusted-repos-is-code.md`.
