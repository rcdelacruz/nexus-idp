# Scaffolder Template Permissions

This guide explains how template access is controlled in Nexus IDP and how to create templates that work within the RBAC system.

## Who Can Use Templates

Template access is governed by the 4-tier RBAC system:

| Role | Can Use Templates | Can Create/Edit Templates in Catalog |
|------|:-----------------:|:------------------------------------:|
| Platform Admin (`backstage-admins`) | ✓ | ✓ |
| Team Lead (`*-lead`) | ✓ | ✓ |
| Assigned Engineer (dept teams) | ✓ | ✗ |
| New User (`general-engineers` only) | ✗ | ✗ |

New users are blocked from the Scaffolder until they are assigned to a department team.

## Template Permissions in Code

The relevant permission checks in `packages/backend/src/plugins/permission.ts`:

```typescript
// Scaffolder: use templates → all assigned engineers + leads
// Create/edit templates in catalog → leads + admins only
if (permissionName.startsWith('scaffolder.')) {
  if (
    permissionName === 'scaffolder.template.create' ||
    permissionName === 'scaffolder.template.update' ||
    permissionName === 'scaffolder.template.delete'
  ) {
    return isLead(groups) ? ALLOW : DENY;   // leads + admins only
  }
  return ALLOW;  // all assigned users can run templates
}
```

## Restricting a Template to a Specific Group

Use the `owner` field in your template to signal ownership. Access enforcement happens at the policy level (not via template metadata annotations — Backstage does not natively support annotation-based permission gating):

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: cloud-infra-template
  title: Cloud Infrastructure Setup
  description: Provision cloud infrastructure — for Cloud Team leads only
spec:
  owner: group:default/cloud-team-lead
  type: infrastructure
  parameters:
    - title: Basic Information
      required: [name]
      properties:
        name:
          title: Project Name
          type: string
  steps:
    - id: fetch
      name: Fetch Template
      action: fetch:template
      input:
        url: ./skeleton
        values:
          name: ${{ parameters.name }}
```

## Using `ConditionalRender` in Custom Template Fields

For custom React field extensions in the Scaffolder, use `ConditionalRender` to gate UI elements by permission:

```tsx
import { ConditionalRender, PermissionButton } from '../common/ConditionalRender';

export const CustomFieldExtension = (props: FieldProps) => {
  return (
    <div>
      {/* Only show for users who can create catalog entities (leads + admins) */}
      <ConditionalRender requiredPermission="catalog.entity.create">
        <TextField label="Catalog Entry Name" ... />
      </ConditionalRender>

      {/* Disabled with tooltip if user lacks permission */}
      <PermissionButton
        requiredPermission="catalog.entity.create"
        disabledMessage="Only team leads can register catalog entries"
        onClick={handleRegister}
      >
        Register in Catalog
      </PermissionButton>
    </div>
  );
};
```

Both components are defined in `packages/app/src/components/common/ConditionalRender.tsx`.

## Registering Templates

Templates in Nexus IDP are loaded from the external `engineering-standards` GitHub repo. To add a new template:

1. Create the template YAML in `https://github.com/your-org/engineering-standards`
2. Add the URL to `catalog.locations` in `app-config.yaml`:

```yaml
catalog:
  locations:
    - type: url
      target: https://github.com/your-org/engineering-standards/blob/main/templates/my-template/template.yaml
      rules:
        - allow: [Template]
```

Only team leads and platform admins can register or delete templates from the catalog.

## Best Practices

- Set `spec.owner` to the group responsible for the template (e.g. `group:default/cloud-team-lead`)
- Keep templates in the external `engineering-standards` repo — not in the portal repo
- Test templates with an assigned-engineer account before announcing to the team
- Use `ConditionalRender` in custom fields, not template-level annotations, for UI gating
