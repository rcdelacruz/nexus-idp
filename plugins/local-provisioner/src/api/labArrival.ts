/**
 * "You just created this lab": the navigation state the Create run page puts on the redirect to the
 * lab (`/local-provisioner/tasks/<id>`), so the lab page can greet the new lab once (the toast that
 * reminds you to accept the GitHub invitation). The lab page removes it after showing the toast, so a
 * reload, Back or a shared link never shows it again.
 */
export function justCreatedState(): { labJustCreated: true } {
  return { labJustCreated: true };
}

/** True when the navigation state says the user was just sent here by a successful Create run. */
export function isJustCreated(state: unknown): boolean {
  return (state as { labJustCreated?: unknown } | null | undefined)?.labJustCreated === true;
}
