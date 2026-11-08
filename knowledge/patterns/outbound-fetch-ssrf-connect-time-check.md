## A server-side "fetch this URL" feature needs the address check at connect time (2026-11-07)

**The mistake:** the CORS proxy compared the URL's host name with a list of strings (`localhost`, `10.*`, the cloud metadata
address). `0.0.0.0`, `[::1]`, the ECS task metadata address, in-cluster DNS names, a public name that resolves to a private
address and a redirect to any of those all passed. The route was also unauthenticated.

**Rule (see `packages/backend/src/plugins/corsProxySafeFetch.ts`):**
- Require a signed-in user (and refuse service tokens) before anything else.
- Resolve the name yourself in a custom `lookup` and refuse when ANY address is not public; the address checked is the address
  connected to (no second lookup, so DNS rebinding cannot swap it).
- A literal IP in the URL never reaches `lookup`: check it before connecting.
- Follow redirects by hand and run the same checks on every hop; strip credential headers on a cross-origin hop (allow-list
  the headers that continue, do not deny-list by name).
- Cap size AND total time (an idle timeout alone lets a target drip bytes forever).
- Never forward the caller's own portal token; carry the credential meant for the target in a separate header.
- Do not serve the target's `Set-Cookie`, CORS or CSP headers from your origin.

**Gotcha:** Node's `net.BlockList` treats an IPv4 address as an IPv4-mapped IPv6 address, so an IPv6 rule for `::ffff:0:0/96`
blocks every IPv4 address. Judge IPv6 separately (allow only 2000::/3 minus the embedded-IPv4 and documentation ranges).
