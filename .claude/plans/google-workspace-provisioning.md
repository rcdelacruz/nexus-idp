# Google Workspace User/Group Provisioning - Implementation Plan

## Overview

Implement automated user/group provisioning from Google Workspace to replace manual YAML management. Uses a **custom entity provider** (no official Google Workspace plugin exists) with a hybrid approach: sync from Google Workspace + keep YAML for special accounts.

## Key Discovery

⚠️ **Important**: There is NO official `@backstage/plugin-catalog-backend-module-google-workspace` plugin. We need to **build a custom entity provider** following Backstage's new backend system patterns.

## Prerequisites (User Must Complete First)

### 1. Google Cloud Project Setup
1. Go to https://console.cloud.google.com
2. Create/select project: `backstage-stratpoint`
3. Enable APIs:
   - Admin SDK API
   - Google Workspace Admin API
4. Create Service Account:
   - Name: `backstage-workspace-sync`
   - Download JSON key → save to `.secrets/google-workspace-sa-key.json`
   - Note: `client_email`, `private_key`, `client_id`

### 2. Google Workspace Admin Console Setup
1. Go to https://admin.google.com
2. Navigate: Security → Access and data control → API controls → Domain-wide delegation
3. Add new with service account `client_id` and scopes:
   ```
   https://www.googleapis.com/auth/admin.directory.user.readonly,
   https://www.googleapis.com/auth/admin.directory.group.readonly,
   https://www.googleapis.com/auth/admin.directory.group.member.readonly
   ```

### 3. Create backstage-admins Google Group
1. In Google Admin Console: Directory → Groups → Create group
2. Email: `backstage-admins@stratpoint.com`
3. Add initial members (e.g., ronaldo.delacruz@stratpoint.com)

## Implementation Steps

### Phase 1: Install Dependencies

**File**: `packages/backend/package.json`
```bash
cd packages/backend
yarn add googleapis@^129.0.0
yarn add @backstage/plugin-catalog-node
```

### Phase 2: Create Custom Entity Provider

**Create directory structure**:
```
packages/backend/src/modules/google-workspace-catalog/
├── GoogleWorkspaceEntityProvider.ts  # Core provider logic
├── types.ts                          # TypeScript types
├── transformers.ts                   # Google → Backstage entity transformers
└── module.ts                         # Backend module integration
```

**Key Implementation Details**:

**`GoogleWorkspaceEntityProvider.ts`**:
- Use `googleapis` library with JWT auth
- Fetch users/groups via Google Directory API
- Transform to Backstage User/Group entities
- Implement `EntityProvider` interface
- Handle pagination, errors, retries
- Use `applyMutation()` to submit entities

**`transformers.ts`**:
- `transformUser()`: Google user → Backstage User entity
- `transformGroup()`: Google group → Backstage Group entity
- Extract email, displayName, memberOf
- Normalize entity names (email prefix: `firstname.lastname@stratpoint.com` → `firstname.lastname`)

**`module.ts`**:
- Follow pattern from `packages/backend/src/plugins/permission-backend-module.ts`
- Use `createBackendModule()` with `catalogProcessingExtensionPoint`
- Register entity provider with scheduler (hourly sync)

### Phase 3: Configuration

**File**: `.env`
```bash
# Add these variables
GOOGLE_WORKSPACE_DOMAIN=stratpoint.com
GOOGLE_WORKSPACE_ADMIN_EMAIL=ronaldo.delacruz@stratpoint.com
GOOGLE_WORKSPACE_KEY_FILE=/Users/ronalddelacruz/Projects/stratpoint/backstage-main-strat-eng/.secrets/google-workspace-sa-key.json
```

**File**: `.gitignore`
```bash
# Add
.secrets/
```

**File**: `app-config.yaml`
```yaml
catalog:
  # Keep existing YAML locations for special accounts
  locations:
    - type: file
      target: ../../stratpoint/org/users.yaml
      rules: [User]
    - type: file
      target: ../../stratpoint/org/groups.yaml
      rules: [Group]

  # NEW: Add Google Workspace provider
  providers:
    googleWorkspace:
      stratpoint:
        domain: ${GOOGLE_WORKSPACE_DOMAIN}
        adminEmail: ${GOOGLE_WORKSPACE_ADMIN_EMAIL}
        serviceAccount:
          keyFile: ${GOOGLE_WORKSPACE_KEY_FILE}
        sync:
          frequency:
            minutes: 60
          timeout:
            minutes: 15
        userNaming:
          strategy: 'email-prefix'
        groupNaming:
          strategy: 'email-prefix'
```

### Phase 4: Backend Integration

**File**: `packages/backend/src/index.ts`
```typescript
// Add after existing catalog modules
backend.add(import('./modules/google-workspace-catalog/module'));
```

### Phase 5: Hybrid Migration Strategy

**Clean up YAML files** to keep only special accounts:

**`stratpoint/org/users.yaml`**:
```yaml
# Keep only service accounts/bots
# Remove ronaldo.delacruz (will come from Google Workspace)
---
apiVersion: backstage.io/v1alpha1
kind: User
metadata:
  name: service-account-github
  annotations:
    backstage.io/managed-by-location: 'file:../../stratpoint/org/users.yaml'
spec:
  profile:
    email: github-bot@stratpoint.com
    displayName: GitHub Integration Bot
  memberOf: [automation-users]
```

**`stratpoint/org/groups.yaml`**:
```yaml
# Keep only special groups not in Google Workspace
---
apiVersion: backstage.io/v1alpha1
kind: Group
metadata:
  name: automation-users
  annotations:
    backstage.io/managed-by-location: 'file:../../stratpoint/org/groups.yaml'
spec:
  type: team
  profile:
    displayName: Automation Users
  parent: stratpoint
  children: []

# All regular groups (engineering-dept, backend-team, etc.)
# will come from Google Workspace - remove them
```

### Phase 6: Testing

**Create test script**: `packages/backend/scripts/test-google-workspace.ts`
```typescript
import { google } from 'googleapis';

async function testAccess() {
  const auth = new google.auth.JWT({
    keyFile: process.env.GOOGLE_WORKSPACE_KEY_FILE,
    scopes: [
      'https://www.googleapis.com/auth/admin.directory.user.readonly',
      'https://www.googleapis.com/auth/admin.directory.group.readonly',
    ],
    subject: process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL,
  });

  const admin = google.admin({ version: 'directory_v1', auth });

  const users = await admin.users.list({ customer: 'my_customer', maxResults: 10 });
  console.log('Users:', users.data.users?.length);

  const groups = await admin.groups.list({ customer: 'my_customer', maxResults: 10 });
  console.log('Groups:', groups.data.groups?.length);
}

testAccess();
```

Run: `npx ts-node scripts/test-google-workspace.ts`

**Verify in Backstage**:
1. Start backend: `yarn workspace backend start`
2. Navigate to http://localhost:3000/catalog
3. Check for users/groups from Google Workspace
4. Verify annotation: `backstage.io/managed-by-location: google-workspace:stratpoint`

### Phase 7: Rollback Plan

**If things go wrong**:

1. **Disable the provider**:
   ```typescript
   // In packages/backend/src/index.ts, comment out:
   // backend.add(import('./modules/google-workspace-catalog/module'));
   ```

2. **Restore YAML files**:
   - Keep backup of original `users.yaml` and `groups.yaml`
   - Restore from backup if needed

3. **Remove synced entities** (if needed):
   ```sql
   DELETE FROM entities
   WHERE annotations->>'backstage.io/managed-by-location' = 'google-workspace:stratpoint';
   ```

## Critical Files to Create/Modify

### New Files
- `packages/backend/src/modules/google-workspace-catalog/GoogleWorkspaceEntityProvider.ts`
- `packages/backend/src/modules/google-workspace-catalog/types.ts`
- `packages/backend/src/modules/google-workspace-catalog/transformers.ts`
- `packages/backend/src/modules/google-workspace-catalog/module.ts`
- `.secrets/google-workspace-sa-key.json` (from Google Cloud)
- `packages/backend/scripts/test-google-workspace.ts`

### Modified Files
- `packages/backend/package.json` (add googleapis dependency)
- `packages/backend/src/index.ts` (register module)
- `app-config.yaml` (add provider configuration)
- `.env` (add Google Workspace variables)
- `.gitignore` (add .secrets/)
- `stratpoint/org/users.yaml` (remove regular users, keep special accounts)
- `stratpoint/org/groups.yaml` (remove regular groups, keep special groups)

## Success Criteria

✅ All Google Workspace users appear in Backstage catalog
✅ All Google Workspace groups appear with correct memberships
✅ backstage-admins@stratpoint.com members have admin permissions
✅ Special accounts from YAML still work
✅ Hourly automatic sync runs without errors
✅ Service account key secured (not in git)

## Reference Implementations

Use these as patterns:
- `packages/backend/src/plugins/permission-backend-module.ts` - New backend system module pattern
- Backstage LDAP module - Similar directory sync approach
- Backstage MS Graph module - Similar API-based entity provider

## Timeline Estimate

- Week 1: Prerequisites (Google Cloud + Workspace setup)
- Week 2: Implementation (provider code)
- Week 3: Testing and iteration
- Week 4: Deployment and monitoring
