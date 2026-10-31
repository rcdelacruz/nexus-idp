# Retro: autonomous run, finishing the persona plan (2026-10-30)

The user was away, with the instruction to finish everything, carefully. Expert review ran at plan
stage for the larger items and at diff stage for all of them.

## Went well
- **Real-runtime proofs caught real bugs that tsc, lint and unit tests missed:**
  - SRE lab: an exercise that couldn't be completed (SRE-08), an SLI that was empty at idle, a
    promtool check that never read the rules, and a one-off fault that never shows in `rate()`;
  - capstone task ordering: Cosign enforced before signing would have broken the trainee's own
    app;
  - Tech Insights: an array `filter` that crashes startup.
- Labs were tested through the agent's **compiled executor**, with no portal deploy needed.
- `develop` stayed deployable: the risky work (G) and the not-yet-servable templates are on branches.

## Went wrong
- The user was interrupted mid-run by my narration ("I said I am away from the keyboard"). For
  away runs, keep updates minimal and never block on questions.
- Several first-draft tests were wrong rather than the code: `/bin/sh` has no `$SECONDS`, the test
  scheduler skips `initialDelay` tasks, and one retry loop swallowed the real error. Print the
  real error before concluding anything.

## Backlog
- [ ] Agent: prefer `config.port` for the connection string (npm publish + OTP).
- [ ] The tech-insights batch endpoint `POST /checks/run` (all entities) is open to every assigned
      user. It's cheap and read-only; a root-router guard could restrict it.
- [ ] The local nexus-dev-toolkit is 3.1.4 and the latest is 3.1.11 (Codex support). Run
      `nexus update`.
- [ ] The "How to fix" docs links only resolve after the develop→main release (docs are served
      from `main`).
