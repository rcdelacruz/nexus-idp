# Managing Users and Groups in Backstage

There are two ways to manage user-group associations in Backstage:

## 1. Manual Management (using org.yaml)

### Creating a Group
```yaml
apiVersion: backstage.io/v1alpha1
kind: Group
metadata:
  name: engineering-team
  description: Engineering Team
spec:
  type: team
  profile:
    displayName: Engineering Team
    email: engineering@stratpoint.com
  children: []  # Sub-groups if any
```

### Adding Users to Groups
```yaml
apiVersion: backstage.io/v1alpha1
kind: User
metadata:
  name: ronaldo.delacruz
spec:
  profile:
    displayName: Ronaldo Dela Cruz
    email: ronaldo.delacruz@stratpoint.com
  # List all groups the user belongs to
  memberOf: [engineering-team, admin-team]
```

### Group Hierarchy Example
```yaml
# Parent Group
apiVersion: backstage.io/v1alpha1
kind: Group
metadata:
  name: engineering
spec:
  type: department
  profile:
    displayName: Engineering Department
  children: [frontend-team, backend-team]

# Child Groups
apiVersion: backstage.io/v1alpha1
kind: Group
metadata:
  name: frontend-team
spec:
  type: team
  profile:
    displayName: Frontend Team
  parent: engineering  # Reference to parent group

apiVersion: backstage.io/v1alpha1
kind: Group
metadata:
  name: backend-team
spec:
  type: team
  profile:
    displayName: Backend Team
  parent: engineering  # Reference to parent group
```

## 2. Google Workspace Integration

### Using Google Groups

1. Create groups in Google Workspace Admin Console:
   - Go to admin.google.com
   - Navigate to Groups
   - Click "Create Group"
   - Name your group (e.g., "Engineering Team")
   - Add members to the group

2. Groups will automatically sync to Backstage when you set up Google Workspace integration
   - Groups appear as Group entities
   - User memberships are automatically maintained
   - Group hierarchy is preserved

### Best Practices for Google Workspace Groups

1. **Naming Conventions:**
   ```
   team-engineering@stratpoint.com
   team-frontend@stratpoint.com
   team-backend@stratpoint.com
   role-admin@stratpoint.com
   project-backstage@stratpoint.com
   ```

2. **Group Types:**
   - Team Groups: For organizational teams
   - Role Groups: For access control
   - Project Groups: For project-specific teams

3. **Group Hierarchy:**
   - Department Groups (top level)
   - Team Groups (mid level)
   - Project/Role Groups (lower level)

## Comparison

### Manual Management (org.yaml)
Pros:
- Simple to understand
- Version controlled
- Good for small teams
- Quick to modify

Cons:
- Manual updates required
- Can become hard to maintain for large organizations
- No automatic synchronization

### Google Workspace Integration
Pros:
- Automatic synchronization
- Centralized management
- Scales well for large organizations
- Maintains real-time group membership

Cons:
- Requires additional setup
- Needs Google Workspace admin access
- More complex initial configuration

## Recommended Approach

1. **Small Teams (< 20 people):**
   - Use manual management with org.yaml
   - Keep group structure simple
   - Regular reviews of group membership

2. **Medium to Large Teams (20+ people):**
   - Use Google Workspace integration
   - Implement clear naming conventions
   - Set up automated synchronization

3. **Hybrid Approach:**
   - Use Google Workspace for team/department groups
   - Use org.yaml for Backstage-specific roles
   - Combine both for flexible management

## Tips for Group Management

1. **Regular Maintenance:**
   - Review group memberships periodically
   - Remove outdated groups
   - Update group descriptions

2. **Documentation:**
   - Document group purposes
   - Maintain group ownership information
   - Keep naming conventions documented

3. **Access Control:**
   - Use groups for permission management
   - Implement principle of least privilege
   - Regular access reviews

4. **Group Structure:**
   - Keep hierarchy shallow (max 3 levels)
   - Use clear, descriptive names
   - Avoid overlapping responsibilities
