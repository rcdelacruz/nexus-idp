# Pattern: removed scaffolder action inputs break templates at runtime

**Discovered:** 2026-10-29, during the 1.54.6 → 1.56.2 bump.

## Constraint

Scaffolder action input schemas are `additionalProperties: false` (zod `z.object` →
zod-to-json-schema), and scaffolder-backend validates each step's input with `jsonschema`
(`NunjucksWorkflowRunner`) before running it. So when an upstream module **removes** an input —
even one documented as "previously accepted but silently ignored" — every template still passing
it fails with `InputError: Invalid input passed to action`. `tsc`, unit tests and catalog template
validation all stay green; only a real template run catches it.

Example: `scaffolder-backend-module-github` 0.10.0 removed `defaultBranch` (and 19 other inputs)
from `github:repo:create`. Fixed in engineering-standards `e4abcc3`.

## How to check on every bump

1. Read the CHANGELOGs of every bumped `scaffolder-backend-module-*` for removed inputs.
2. `grep -rn` the action id across `/tank/Projects/engineering-standards/templates`.
3. Prove it: build the action from the installed module and `jsonschema.validate(input, action.schema.input)`
   for both the current and the fixed template input (resolve modules via
   `require('module').createRequire('<repo>/packages/backend/package.json')`).
4. Removing an ignored input is backward-compatible — push the template fix BEFORE deploying the bump.
