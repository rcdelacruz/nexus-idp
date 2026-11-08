# Pattern: the agent runs queued tasks side by side, so the portal waits between dependent tasks

**Discovered:** 2026-11-03, building "Retry removes the lab that holds the port" (Local Provisioner).

## Constraint

`Agent.pollLoop` starts every task it receives in one poll without awaiting it. Two tasks queued
back to back (teardown of lab A, then provision of lab B) run at the same time, and B's pre-flight can
see the port still taken. Task order in the queue is not execution order.

## Rule

When task 2 needs task 1 to be finished, do not just queue both. Queue task 1, wait until the portal
shows it `completed` (poll `GET /tasks/:id`, tolerate a couple of failed reads, give up with a message
that says the task stays queued), then queue task 2. Changing the agent needs an npm publish with an
OTP, so the portal side must carry this.

## Related facts found on the way

- A lifecycle task (`stop`, `start`, `restart`, `deprovision`) must carry the lab's PROVISION task id
  as `config.targetTaskId`: the agent keeps the lab's folder under that id. An id that has no folder
  is not an error for `deprovision`: it answers success ("Nothing was running; removed the empty lab
  folder") and removes nothing, so a "completed" teardown only proves something when the id is right.
- `foldTasksToResource` reports `provisioning` while ANY task of the lab is pending or in progress
  (setup, removal, restart). Treat that state as "busy", never as "holds its ports".
- A failed provision already cleans up after itself on the agent (`down -v`, folder removed), so a
  retry of the same lab never conflicts with its own leftovers.
- Ask the portal again right before removing anything the user confirmed earlier: time passes while a
  dialog is open. Remove only what is both confirmed and still there; stop if something new appeared.
