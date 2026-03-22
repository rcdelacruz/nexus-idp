# Backstage Permission System

This document describes the permission system implementation in our Backstage instance, including how it works and how to use it.

## Overview

The permission system in Backstage controls what actions users can perform based on their roles. Users with different roles have different permissions, and the system enforces these permissions both in the UI and at the API level.

The main roles in the system are:

- **backstage-admin**: Full access to all features
- **backstage-editor**: Can read and create entities, but not delete them
- **backstage-reader**: Can only read entities, not create or modify them
- **project-creator**: Can create new projects
- **team-manager**: Can manage teams
- **catalog-maintainer**: Can maintain the catalog

## Permission Mapping

Each role is mapped to a set of permissions in the `roleMapping` object in `packages/backend/src/plugins/auth.ts`:

```typescript
const roleMapping: Record<string, string[]> = {
  'backstage-admin': [
    'catalog.entity.read',
    'catalog.entity.create',
    'catalog.entity.delete',
    'scaffolder.project.create',
    'catalog.team.manage',
    'catalog.maintain'
  ],
  'backstage-editor': [
    'catalog.entity.read',
    'catalog.entity.create',
    'scaffolder.project.create'
  ],
  'backstage-reader': [
    'catalog.entity.read'
  ],
  'project-creator': [
    'catalog.entity.read',
    'catalog.entity.create',
    'scaffolder.project.create'
  ],
  'team-manager': [
    'catalog.entity.read',
    'catalog.team.manage'
  ],
  'catalog-maintainer': [
    'catalog.entity.read',
    'catalog.entity.create',
    'catalog.maintain'
  ]
};
```

## Frontend Components

To provide a good user experience, we've implemented several custom components that handle permissions in the UI:

### ConditionalRender

The `ConditionalRender` component conditionally renders its children based on whether the user has the required permission. If the user doesn't have the permission, it renders a fallback component instead.

**Usage:**

```tsx
<ConditionalRender
  requiredPermission="scaffolder.project.create"
  fallback={<PermissionDeniedPage requiredPermission="scaffolder.project.create" />}
>
  <ScaffolderPage />
</ConditionalRender>
```

**Props:**

- `requiredPermission`: The permission that the user must have to see the children
- `children`: The content to render if the user has the required permission
- `fallback`: Optional content to render if the user does not have the required permission

### PermissionButton

The `PermissionButton` component is a button that is enabled only if the user has the required permission. If the user doesn't have the permission, the button is disabled and shows a tooltip explaining why.

**Usage:**

```tsx
<PermissionButton
  requiredPermission="scaffolder.project.create"
  disabledMessage="You don't have permission to create components"
  className={classes.actionButton}
  color="primary"
  href="/create"
>
  Create Component
</PermissionButton>
```

**Props:**

- `requiredPermission`: The permission that the user must have to enable the button
- `disabledMessage`: Optional message to show in the tooltip when the button is disabled
- `...props`: All other props are passed to the underlying Button component

### PermissionDeniedPage

The `PermissionDeniedPage` component is a page that is shown when the user doesn't have the required permission to access a route.

**Usage:**

```tsx
<PermissionDeniedPage requiredPermission="scaffolder.project.create" />
```

**Props:**

- `requiredPermission`: Optional permission to display in the error message

## Protecting Routes

To protect a route, wrap the route element with the `ConditionalRender` component and provide a fallback component to show when the user doesn't have the required permission:

```tsx
<Route
  path="/create"
  element={
    <ConditionalRender
      requiredPermission="scaffolder.project.create"
      fallback={<PermissionDeniedPage requiredPermission="scaffolder.project.create" />}
    >
      <ScaffolderPage />
    </ConditionalRender>
  }
/>
```

## Conditional UI Elements

To conditionally show or hide UI elements based on permissions, use the `PermissionButton` component for buttons:

```tsx
<PermissionButton
  requiredPermission="scaffolder.project.create"
  disabledMessage="You don't have permission to create components"
  className={classes.actionButton}
  color="primary"
  href="/create"
>
  Create Component
</PermissionButton>
```

For other UI elements, you can use the `ConditionalRender` component:

```tsx
<ConditionalRender requiredPermission="catalog.entity.create">
  <MyComponent />
</ConditionalRender>
```

### Group-Based Permissions

In addition to permission-based checks, you can also conditionally render UI elements based on the user's group membership. To do this, you can extend the `ConditionalRender` component to check for group membership:

```tsx
type GroupConditionalRenderProps = {
  requiredGroup: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

export const GroupConditionalRender = ({
  requiredGroup,
  children,
  fallback = null,
}: GroupConditionalRenderProps) => {
  const identityApi = useApi(identityApiRef);
  const [isMember, setIsMember] = useState<boolean | null>(null);

  useEffect(() => {
    const checkGroupMembership = async () => {
      try {
        const identity = await identityApi.getBackstageIdentity();
        const groups = ((identity as any).claims?.groups as string[]) || [];
        const member = groups.includes(requiredGroup);
        setIsMember(member);
      } catch (error) {
        console.error('Error checking group membership:', error);
        setIsMember(false);
      }
    };

    checkGroupMembership();
  }, [identityApi, requiredGroup]);

  // Show loading indicator while checking group membership
  if (isMember === null) {
    return <Progress />;
  }

  // Render children if the user is a member of the required group, otherwise render the fallback
  return isMember ? <>{children}</> : <>{fallback}</>;
};
```

You can use this component to conditionally render UI elements based on group membership:

```tsx
<GroupConditionalRender requiredGroup="engineering-team">
  <Button>Engineering Team Action</Button>
</GroupConditionalRender>
```

You can also combine permission and group checks for more complex scenarios:

```tsx
<ConditionalRender requiredPermission="catalog.entity.create">
  <GroupConditionalRender requiredGroup="engineering-team">
    <Button>Create Engineering Component</Button>
  </GroupConditionalRender>
</ConditionalRender>
```

## Backend Permission System

The backend permission system is implemented in `packages/backend/src/plugins/permission.ts` and `packages/backend/src/plugins/permission-policy.ts`. It checks if the user has the required permission for each request and denies the request if they don't.

The `CatalogPermissionPolicy` class in `packages/backend/src/plugins/permission.ts` implements the `PermissionPolicy` interface from `@backstage/plugin-permission-node`. It extracts the user's permissions from the request and checks if the user has the permission required for the request.

```typescript
export class CatalogPermissionPolicy implements PermissionPolicy {
  async handle(request: PolicyQuery): Promise<PolicyDecision> {
    // Extract user claims from the request
    const claims = (request as any).identity?.claims || {};

    // Extract permissions from claims
    const userPermissions = (claims.permissions as string[]) || [];

    // Check if the user has the permission required for this request
    const hasPermission = userPermissions.includes(request.permission.name);

    if (hasPermission) {
      return { result: AuthorizeResult.ALLOW };
    }

    return { result: AuthorizeResult.DENY };
  }
}
```

## Conclusion

This permission system provides a good user experience by showing disabled buttons with tooltips for actions that the user doesn't have permission for, and showing a friendly error page when the user tries to access a restricted route directly. The backend permission system ensures that the restrictions are enforced at the API level, so there's no security risk.
