# Pattern: a drawer opened by URL must share its page's transition key, and a redirect needs a mark

**Discovered:** 2026-11-03, sending the user to their lab (and its drawer) after a successful Create run.

## Constraint

`Root.tsx` wrapped every routed page in `<PageTransition key={location.pathname}>`. The key changes
whenever the path changes, and a changed key REMOUNTS the page. A drawer that is addressed by URL
(`/local-provisioner/tasks/<id>` on top of `/local-provisioner`) therefore rebuilt the whole page when
it was closed (`navigate('/local-provisioner')`): the task list reloaded from empty, the agent filter
and row selection were lost and the 0.2 s fade replayed.

## Rule

- Give the drawer URL the same transition key as the page under it: `pageTransitionKey(pathname)` in
  `Root/pageRouting.tsx` maps a lab URL to `/local-provisioner`. Any new "page + drawer in the URL"
  must be added there. Tested with the real `RoutedPage` and a mount counter.
- A sidebar item that matches its path exactly (`exact`) goes dark on the drawer URL: extend
  `isNavItemActive`, and keep sibling items under the same prefix (Trainees) from lighting up.
- Derive the drawer from the URL instead of copying the URL into state (`urlTask = tasks.find(...)`, read
  from the FULL list so a filter cannot hide it); close it by replacing the URL. Do not decide
  "not found" while the list is loading or failed to load, post the warning once, and close quietly when
  a lab that was open disappears.
- A redirect that leaves a finished page must use `navigate(..., { replace: true })`, or Back returns to
  a finished page that sends you forward again.
- A redirect must only fire for a run the user JUST started. Put a mark in the navigation state
  (`labRedirect.ts`, a timestamp), and let it expire: browser history state survives reload, Back and
  tab restore. Opening an old finished run from a list must leave the user on its log.
- Follow a link only after parsing it strictly (`parseLabTaskPath`: exact prefix, uuid, one optional
  trailing slash, lowercased) and navigate to the path you rebuilt, never to the link as given.

## Related facts found on the way

- The scaffolder's run stream (`useEventStream`) sets `completed`, `output` and `error` in one step; a
  failed run carries `error`, a lost connection sets `error` AND `completed`, a run whose heartbeat is
  lost completes with only a message (no error, no output). So "success" = completed, no error, not
  cancelled, no failed step AND the expected output link present.
- `CustomTaskPage` has never rendered `output.text` (the "Start here" block every lab template
  defines), only `output.links`, and opens any link with a `url` in a new tab.
- A test default parameter swallows `undefined`: `openRun(stream, undefined)` used the default, so the
  "no mark" case silently tested the "marked" case. Use a sentinel for "explicitly nothing".
- A mutation can survive for a good reason: weakening `startsWith(BASE)` to `includes(BASE)` is
  equivalent because the id is cut at a fixed offset. Break the check completely, and add inputs of the
  same length with a different prefix.
