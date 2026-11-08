/**
 * The Multipass instance name a VM lab gets, as agents up to 0.1.30 derive it from the resource
 * name (MultipassExecutor.instanceName): lower-cased, anything but letters/digits/hyphens turned into
 * hyphens, cut at 63 characters. Two different resource names longer than 63 characters can
 * therefore give the SAME instance name, which is why the portal checks for a collision before it
 * offers to remove a VM.
 */
export function vmInstanceName(resourceName: string): string {
  const n = resourceName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63)
    .replace(/-$/, '');
  return /^[a-z]/.test(n) ? n : `lab-${n}`.slice(0, 63);
}
