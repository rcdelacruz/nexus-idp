# Retro: Retry removes the lab that holds the port (2026-11-03)

Branch `feat/retry-replaces-conflicting-lab`, uncommitted. Pattern:
`knowledge/patterns/portal-must-wait-between-agent-tasks.md`.

## Went well
- The portal log answered what happened before any code was written: the first attempt failed on the
  port, the Retry succeeded, and the error Ronald pasted came from Docker Desktop starting a
  different, older lab. That turned "retry should delete the old one" into the real rule (another
  lab of yours holds the port) and showed that a failed attempt already cleans itself.
- Comparing the port parser with `docker compose config --format json` on all 14 real compose files
  found a real gap (`${VAR:-port}`) that hand-written fixtures missed.
- The independent review found that "provisioning" means any open task, which would have offered a
  lab that was already being removed. Fixed by offering running labs only.

## Went badly
- The first ordering test passed against code that did not wait: the fake recorded the call
  synchronously. It now records completion too (found by breaking the rule on purpose).
- Three older Postgres tests wiped each other when run in parallel; they only run when
  `LP_TEST_PG_URL` is set, which is why nobody saw it.

## Backlog (existing behaviour, not caused by this change)
- Start / Stop & remove / Restart in the row menu send the clicked row's id as `targetTaskId`, and
  after a Stop the latest row is the stop task. Start then answers "Resource not found locally" and
  Remove reports success without removing anything. Fix: resolve the lab's provision task id (server
  side in `POST /tasks` is the most robust place).
- The agent's port-clash message tells the user to "provision it again with another port in the
  form", which is wrong for labs with no port field. Needs an agent release.

# Addendum: Overview first step in the Create wizard (same day, same branch)

## Went well
- The text in the 12 templates was checked sentence by sentence against each template's steps,
  `repoVisibility`, `if:` conditions and compose services by an independent reviewer; none was wrong.
- Rendering every real template file through the real wizard page found a wrong test fixture
  (real manifests carry `ui:field` inside the schema, not in a separate uiSchema) before it hid a
  real problem, and gives a standing guard that a template cannot name a field the app does not register.

## Went badly
- The first preview was drawn from the colour palette alone and did not look like the real page.
  Read the page's render code and theme overrides before drawing anything (memory:
  feedback_shipped_ui_must_match_the_preview).
- I picked the template scope myself after asking in a paragraph; Ronald wanted the choice put to him.
  Put every scope decision in AskUserQuestion, not in prose.
- Restoring mutated files with `git checkout` also threw away uncommitted work in two templates;
  back files up and restore the copy.

## Backlog
- `buildOverview` is pure: when every template gets an Overview, an automatic one for templates with
  no authored text can be built from the same function inside the wizard page.
- Overview text such as `format` and `gradedBy` is copied from each description by hand; the
  description is the source of truth.
- devops, devsecops, SRE and Terraform B send `sourceDir` (agent 0.1.21+) without `minAgentVersion` in their check step.

# Addendum 2: failed VM lab attempts, Remove trainee naming, answer key (same day)

## Went well
- Both of Ronald's pasted messages were reproduced exactly with the real compiled executor and a fake
  `multipass` before anything was changed; the same script then showed what "Stop & remove" on the
  failed row does, so the immediate unblock was a fact, not a guess.
- The earlier "Retry removes the old one" machinery (plan endpoint, wait-for-completion) was reused
  for the VM leftover instead of a second mechanism.

## Went badly
- The repo-name guard was written for `<capstone id>-capstone-` names and silently broke when the
  capstone ids and template prefixes were renamed to -a/-b. A rename of ids needs a grep for every place
  that derives a name from the id.
- A leftover finder test passed for the wrong reason (a status check shadowed the state check it was
  meant to test); found only by breaking the rule on purpose.
- An edit script with a slice whose end index sat before its start index inserted text between every
  character of a file. Restore from git, and assert `start < end` in such scripts.

## Backlog
- Publish the agent (0.1.31): needs the owner's OTP. Until then a VM lab that fails after `launch` on a
  0.1.30 agent leaves its VM running until Retry or "Stop & remove" removes it.
- `No route to host` on Ronald's Mac is not diagnosed (his network, not the code). Next step is on his
  machine: `multipass list`, `ping <vm ip>` and `ssh` from Terminal with the VPN on and off.
