/**
 * The portal path of one lab in Local Provisioner: `/local-provisioner/tasks/<task id>`.
 *
 * The `stratpoint:local-provision` action outputs this path as `taskUrl` and every lab template
 * shows it as an output link. The Create run page follows it when a run succeeds and the
 * Local Provisioner page opens that lab's drawer from it. Both read the path through this one
 * file, so the format cannot drift between them.
 */
/** The Local Provisioner page (the list of your labs). */
export const LOCAL_PROVISIONER_PATH = '/local-provisioner';

const BASE = `${LOCAL_PROVISIONER_PATH}/tasks/`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The path that opens the lab of this task. */
export function labTaskPath(taskId: string): string {
  return `${BASE}${taskId}`;
}

/**
 * The task id in a lab path, lowercased (task ids are Postgres uuids and come back lowercase),
 * or undefined for anything else: another page, an absolute or protocol-relative URL, a path
 * with extra segments, a query or a fragment. A lab path with one trailing slash is accepted.
 */
export function parseLabTaskPath(pathname: unknown): string | undefined {
  if (typeof pathname !== 'string' || !pathname.startsWith(BASE)) return undefined;
  const id = pathname.slice(BASE.length).replace(/\/$/, '');
  return UUID.test(id) ? id.toLowerCase() : undefined;
}
