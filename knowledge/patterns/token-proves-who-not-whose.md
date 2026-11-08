## A valid token proves WHO is calling, not that the object is theirs (2026-11-07)

**The mistake:** the Local Provisioner agent routes verified the signed service token and then acted on whatever task or agent id
the request named. The first security review fixed token forgery and stopped there: "the identity is now trustworthy, so the route
is safe". It was not. Any holder of any valid token could report on another person's task, queue a task on another person's
agent, and (through the login flow) take over an agent whose id they knew.

**Rule:** for every route, action and function that takes an id (task, agent, enrollment, repo, resource), ask two questions and
write the answer down: who may call it, and whose object is it. Compare the object's owner with the caller; do not rely on the id
being hard to guess. Check the relation that really matters (here: the agent that receives a task), and when two relations exist
(task.user_id and the agent's owner) require both.

**Details that bit:**
- Answer 404 for both "no such object" and "not yours" (no existence leak). The agent client drops 4xx and retries 5xx, so a
  refusal must be a 4xx and a database error must stay a 5xx.
- An id that arrives in a request body (a login presenting `agent_id`) is a claim, not a fact: never move a row to another user
  because the claim names it. Give the new user their own row.
- An id can be vacated (renamed row) and re-registered by someone else: filter delivery by the object's own owner too.
- Compare emails case-insensitively, trimmed, and never treat a missing value as equal.
- Test the refusal, not the success: assert the write did NOT happen (the success case passes without the guard), use two real
  tokens against the same row, and run the real store (Postgres) at least once.
