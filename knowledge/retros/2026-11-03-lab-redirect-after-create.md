# Retro: Create → your lab and its drawer (2026-11-03)

Ronald: "if possible to redirect to your server and show drawer after the provisioning wizard", then
"of course, for successful only, if error, it will stay on the wizard page". Pattern:
`knowledge/patterns/url-addressed-drawer-must-not-remount-the-page.md`.

## Backlog (found, not fixed — outside this task's scope)

- **`CustomTaskPage` does not render `output.text`.** All 12 lab templates define a "Start here"
  block (trainee number, what to do next); the run page only shows `output.links`, so trainees have
  never seen it. The redirect moves them off the run page, which never had it. Decide whether the
  drawer (or the run page) should show it.
- **In-app output links open in a new tab** (`target=_blank` for any link with a `url`). Now harmless:
  the tab lands on the lab's drawer. A router `Link` for relative URLs would be nicer.
- **The new page tests wait in real time** against the 3 s task poll (about 25 s idle per run of
  `LocalProvisionerPage.deeplink*.test.tsx`). Fake timers would make them instant.
- The template guard runs only where the engineering-standards checkout sits next to this repo
  (same as the other `labTemplates.render` guards).

## Process notes

- Two breakages survived the first run of the 28 deliberate-breakage checks (an equivalent-looking
  prefix check, and a warn-once guard my test never re-ran). Both were test gaps, fixed with new cases.
- The plan review caught a real defect before any code (the page remount on closing the drawer).
