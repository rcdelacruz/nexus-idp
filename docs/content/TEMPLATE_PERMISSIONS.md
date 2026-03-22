# Building Templates with Permissions and Roles

This document explains how to build templates that incorporate permission checks and role-based access control in Backstage.

## Overview

When creating templates for Backstage, you may want to restrict who can use certain templates or specific actions within templates based on their roles and permissions. This guide will show you how to:

1. Create templates that check for permissions
2. Add role-based access control to template steps
3. Implement permission checks in template UI components
4. Test templates with different user roles

## Template Permission Basics

### Permission Checks in Template Metadata

You can specify required permissions in your template metadata to control who can see and use the template:

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: example-template
  title: Example Template
  description: An example template with permission checks
  annotations:
    # Specify required permissions to use this template
    backstage.io/permissions: scaffolder.project.create
spec:
  # Template specification...
```

With this annotation, only users with the `scaffolder.project.create` permission will be able to see and use this template.

### Multiple Permission Requirements

You can specify multiple required permissions by using a comma-separated list:

```yaml
annotations:
  backstage.io/permissions: scaffolder.project.create,catalog.entity.create
```

This requires the user to have both permissions to use the template.

## Role-Based Template Steps

You can create templates that have different steps based on the user's role. This is useful when you want to provide different options or workflows for different types of users.

### Conditional Steps

Use the `if` condition in your template steps to check for specific permissions:

```yaml
spec:
  steps:
    # Step visible to all users
    - id: fetch
      name: Fetch Base
      action: fetch:template
      input:
        url: ./skeleton
        values:
          name: ${{ parameters.name }}

    # Step only for users with admin permissions
    - id: admin-setup
      name: Admin Setup
      if: ${{ user.permissions | includes('catalog.entity.delete') }}
      action: custom:admin-setup
      input:
        repoUrl: ${{ parameters.repoUrl }}

    # Step only for users with create permissions
    - id: create-repo
      name: Create Repository
      if: ${{ user.permissions | includes('scaffolder.project.create') }}
      action: publish:github
      input:
        repoUrl: ${{ parameters.repoUrl }}
```

### User Context in Templates

The `user` context object is available in templates and contains information about the current user, including:

- `user.entity`: The user entity from the catalog
- `user.permissions`: Array of permission strings the user has
- `user.roles`: Array of role strings the user has
- `user.groups`: Array of group names the user belongs to

You can use these properties in your template conditions:

```yaml
if: ${{ user.roles | includes('backstage-admin') }}
```

## Group-Based Permissions in Templates

In addition to role-based permissions, you can also restrict template access and steps based on the user's group membership. This is particularly useful in organizations that organize teams into groups.

### Checking Group Membership

You can check if a user belongs to a specific group using the `user.groups` property:

```yaml
if: ${{ user.groups | includes('engineering-team') }}
```

### Combining Group and Role Checks

You can combine group membership and role checks for more granular control:

```yaml
if: ${{ user.groups | includes('engineering-team') && user.roles | includes('backstage-editor') }}
```

### Example: Group-Based Template

Here's an example of a template that uses group-based permissions:

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: group-restricted-template
  title: Group Restricted Template
  description: A template that uses group-based permissions
  annotations:
    # Only visible to members of the platform-team group
    backstage.io/permission-conditions: 'user.groups | includes("platform-team")'
spec:
  owner: platform-team
  type: service

  parameters:
    - title: Basic Information
      required:
        - name
      properties:
        name:
          title: Name
          type: string
          description: Name of the service

    # Options only for members of the security-team group
    - title: Security Options
      if: ${{ user.groups | includes('security-team') }}
      properties:
        securityLevel:
          title: Security Level
          type: string
          enum: ['low', 'medium', 'high']
          default: 'medium'
          description: Security level of the service

  steps:
    # Basic step for all users
    - id: fetch-template
      name: Fetch Template
      action: fetch:template
      input:
        url: ./skeleton
        values:
          name: ${{ parameters.name }}

    # Step only for members of the security-team group
    - id: security-scan
      name: Security Scan
      if: ${{ user.groups | includes('security-team') }}
      action: security:scan
      input:
        level: ${{ parameters.securityLevel }}
```

## Creating Custom Template Actions with Permission Checks

You can create custom template actions that include permission checks:

```typescript
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { PermissionEvaluator } from '@backstage/plugin-permission-common';

export const createCustomAction = (options: {
  permissionApi: PermissionEvaluator;
}) => {
  return createTemplateAction<{ requiredPermission?: string }>({
    id: 'custom:permission-action',
    schema: {
      input: {
        type: 'object',
        properties: {
          requiredPermission: {
            type: 'string',
            description: 'The permission required to execute this action',
          },
        },
      },
    },
    async handler(ctx) {
      // Check if a permission is required
      if (ctx.input.requiredPermission) {
        // Get the current user's identity
        const { identity } = ctx;

        // Check if the user has the required permission
        const decision = await options.permissionApi.authorize({
          permission: { name: ctx.input.requiredPermission },
          identity,
        });

        // If the user doesn't have permission, throw an error
        if (decision.result !== 'ALLOW') {
          throw new Error(`You don't have the required permission: ${ctx.input.requiredPermission}`);
        }
      }

      // Continue with the action...
      ctx.logger.info('Executing custom action with permission check');

      // Action implementation...
    },
  });
};
```

## Template UI Components with Permission Checks

When creating custom form components for templates, you can use the `ConditionalRender` and `PermissionButton` components to conditionally render UI elements based on permissions:

```tsx
import React from 'react';
import { FieldProps } from '@rjsf/core';
import { ConditionalRender, PermissionButton } from '../common';

export const CustomFieldExtension = (props: FieldProps) => {
  const { formData, onChange } = props;

  return (
    <div>
      <h3>Custom Field</h3>

      {/* Basic field visible to all users */}
      <TextField
        label="Basic Field"
        value={formData.basicField || ''}
        onChange={e => onChange({ ...formData, basicField: e.target.value })}
      />

      {/* Advanced field only visible to users with specific permission */}
      <ConditionalRender requiredPermission="catalog.entity.create">
        <TextField
          label="Advanced Field"
          value={formData.advancedField || ''}
          onChange={e => onChange({ ...formData, advancedField: e.target.value })}
        />
      </ConditionalRender>

      {/* Action button only enabled for users with specific permission */}
      <PermissionButton
        requiredPermission="scaffolder.project.create"
        disabledMessage="You don't have permission to create projects"
        onClick={() => {
          // Perform action
        }}
      >
        Create Project
      </PermissionButton>
    </div>
  );
};
```

## Testing Templates with Different Roles

To test your templates with different user roles:

1. Create test users with different roles in your auth provider
2. Log in as each user and verify that they see the appropriate template options
3. Check that permission-restricted steps and actions work as expected
4. Verify that UI components are conditionally rendered based on permissions

### Example Test Plan

1. Create the following test users:
   - Admin user with `backstage-admin` role
   - Editor user with `backstage-editor` role
   - Reader user with `backstage-reader` role

2. Test template visibility:
   - Log in as each user and verify they see only the templates they have permission to use
   - Check that template cards in the catalog show appropriate tooltips for disabled templates

3. Test template execution:
   - Try executing templates with each user
   - Verify that permission-restricted steps are skipped for users without the required permissions
   - Check that error messages are clear when permission checks fail

4. Test UI components:
   - Verify that form fields are conditionally rendered based on permissions
   - Check that buttons are disabled with tooltips for users without the required permissions

## Best Practices

1. **Be explicit about permissions**: Always clearly document what permissions are required for each template and step.

2. **Provide helpful error messages**: When a user doesn't have permission to perform an action, provide a clear error message explaining what permission they need.

3. **Use the least privilege principle**: Only require the minimum permissions necessary for a template or step to function.

4. **Consider fallbacks**: When possible, provide alternative workflows for users with limited permissions rather than simply blocking them.

5. **Test thoroughly**: Test your templates with users of different roles to ensure the permission checks work as expected.

## Example Template with Permission Checks

Here's a complete example of a template that incorporates permission checks:

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: service-template
  title: Create Service
  description: Create a new microservice with role-based options
  annotations:
    backstage.io/permissions: catalog.entity.read
spec:
  owner: team-platform
  type: service

  parameters:
    - title: Basic Information
      required:
        - name
        - description
      properties:
        name:
          title: Name
          type: string
          description: Name of the service
        description:
          title: Description
          type: string
          description: Description of the service

    # Advanced options only shown to users with create permission
    - title: Advanced Options
      if: ${{ user.permissions | includes('catalog.entity.create') }}
      properties:
        repoUrl:
          title: Repository URL
          type: string
          description: URL of the repository

    # Admin options only shown to users with admin role
    - title: Admin Options
      if: ${{ user.roles | includes('backstage-admin') }}
      properties:
        team:
          title: Team
          type: string
          description: Team that owns the service

  steps:
    # Basic step for all users
    - id: fetch-template
      name: Fetch Template
      action: fetch:template
      input:
        url: ./skeleton
        values:
          name: ${{ parameters.name }}
          description: ${{ parameters.description }}

    # Step for users with create permission
    - id: publish
      name: Publish
      if: ${{ user.permissions | includes('catalog.entity.create') }}
      action: publish:github
      input:
        repoUrl: ${{ parameters.repoUrl }}

    # Step for admin users
    - id: register-team
      name: Register Team
      if: ${{ user.roles | includes('backstage-admin') }}
      action: catalog:register
      input:
        teamName: ${{ parameters.team }}

    # Final step for all users
    - id: log
      name: Log
      action: debug:log
      input:
        message: Template execution completed
```

## Conclusion

By incorporating permission checks and role-based access control in your templates, you can create more flexible and secure workflows that adapt to different user roles. This approach allows you to provide a tailored experience for each user while ensuring that they can only perform actions they have permission for.
