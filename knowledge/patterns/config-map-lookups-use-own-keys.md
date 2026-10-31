# Pattern: look up user-influenced keys in config maps by own key only

**Discovered:** 2026-10-30, LP-1 (generic `provision-training` type).

## Constraint

`config.get('some.map')` returns a plain object. Indexing it with a key that a user or template
controls, such as `resourceDocsUrls[labId]`, reaches `Object.prototype`. Keys like `constructor`,
`toString` and `valueOf` return a **Function**, which is truthy. So code shaped like
`const url = map[key]; if (url) …` attaches a function as a docs link or a catalog `dependsOn`. A
slug check doesn't help, because `constructor` is a perfectly valid slug.

## How to apply

- Use `Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined`. In the Local
  Provisioner this is `lookupByResourceType()` in `plugins/local-provisioner-backend/src/types.ts`;
  reuse it.
- Any value that becomes a catalog **tag** must match `CommonValidatorFunctions.isValidTag`
  (`^[a-z0-9+#]+(-[a-z0-9+#]+)*$`, max 63). A slug regex like `[a-z0-9-]` allows `a--b`, which fails
  entity validation on every refresh. Test generated entities against that validator, not a
  re-typed regex.
