# Setting Up Google Workspace Integration with Backstage

This guide explains how to integrate Google Workspace with Backstage to automatically sync users and groups.

## Prerequisites

1. A Google Workspace (formerly G Suite) account with admin access
2. Access to the Google Cloud Console
3. Backstage instance with Google Auth already configured

## Step 1: Set Up Google Cloud Project

1. Go to the [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select your existing Backstage project
3. Enable the following APIs:
   - Admin SDK API
   - Google Workspace Domain-wide Delegation

## Step 2: Create Service Account

1. In Google Cloud Console, go to "IAM & Admin" > "Service Accounts"
2. Click "Create Service Account"
3. Name: `backstage-workspace-sync`
4. Create and download the JSON key file
5. Save the following from the JSON file:
   - client_email
   - private_key
   - project_id

## Step 3: Configure Domain-Wide Delegation

1. Go to your [Google Workspace Admin Console](https://admin.google.com)
2. Navigate to Security > API Controls
3. In the "Domain-wide Delegation" section, click "Add new"
4. Enter the service account's Client ID
5. Add the following OAuth scopes:
   ```
   https://www.googleapis.com/auth/admin.directory.user.readonly
   https://www.googleapis.com/auth/admin.directory.group.readonly
   https://www.googleapis.com/auth/admin.directory.group.member.readonly
   ```

## Step 4: Install Required Packages

```bash
# In your Backstage root directory
yarn add @backstage/plugin-catalog-backend-module-google-workspace
```

## Step 5: Configure Backstage

1. Add the following to your `app-config.yaml`:

```yaml
catalog:
  providers:
    googleWorkspace:
      # Your Google Workspace domain
      domain: 'stratpoint.com'
      # Service account credentials
      serviceAccountEmail: ${GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL}
      privateKey: ${GOOGLE_WORKSPACE_PRIVATE_KEY}
      # Admin user email who can impersonate the service account
      adminEmail: 'admin@stratpoint.com'
      # Optional: Group naming patterns
      groupNamingStrategy:
        prefix: 'googleworkspace-'
      # Optional: User naming strategy
      userNamingStrategy:
        prefix: ''
```

2. Add these environment variables to your `.env`:

```bash
GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL=your-service-account@project-id.iam.gserviceaccount.com
GOOGLE_WORKSPACE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYour Private Key Here\n-----END PRIVATE KEY-----\n"
```

## Step 6: Add Google Workspace Provider

Add this to your `packages/backend/src/plugins/catalog.ts`:

```typescript
import { GoogleWorkspaceOrgEntityProvider } from '@backstage/plugin-catalog-backend-module-google-workspace';

export default async function createPlugin(
  env: PluginEnvironment,
): Promise<Router> {
  const builder = await CatalogBuilder.create(env);

  // Add Google Workspace provider
  builder.addEntityProvider(
    GoogleWorkspaceOrgEntityProvider.fromConfig(env.config, {
      logger: env.logger,
      schedule: env.scheduler.createScheduledTaskRunner({
        frequency: { minutes: 60 },
        timeout: { minutes: 15 },
      }),
    }),
  );

  // ... rest of your catalog configuration

  const { processingEngine, router } = await builder.build();
  await processingEngine.start();

  return router;
}
```

## What This Does

1. **Automatic User Sync:**
   - Creates user entities for all Google Workspace users
   - Updates user profiles with display names and photos
   - Maintains email information

2. **Automatic Group Sync:**
   - Creates group entities for all Google Workspace groups
   - Maintains group membership
   - Updates group metadata (description, email)

3. **Hierarchy Maintenance:**
   - Preserves organizational structure
   - Maintains parent-child relationships between groups
   - Keeps track of user group memberships

## Managing Users and Groups

After setup:

1. **Users:**
   - New users are automatically added when they join your Google Workspace
   - User profiles are updated when changed in Google Workspace
   - Users are automatically removed when they leave

2. **Groups:**
   - Create groups in Google Workspace Admin Console
   - Groups automatically sync to Backstage
   - Group memberships are maintained automatically

3. **Permissions:**
   - Use Backstage's permission framework to control access
   - Assign roles based on group membership
   - Configure access policies using synchronized groups

## Best Practices

1. **Group Naming:**
   - Use consistent naming conventions in Google Workspace
   - Consider using prefixes for different types of groups (e.g., team-, project-, role-)
   - Document your naming conventions

2. **Sync Frequency:**
   - Default sync is every 60 minutes
   - Adjust the schedule based on your needs
   - Consider your API quota limits

3. **Monitoring:**
   - Monitor the Backstage logs for sync issues
   - Set up alerts for sync failures
   - Regularly verify group memberships

## Troubleshooting

1. **Sync Issues:**
   - Check service account permissions
   - Verify OAuth scopes
   - Ensure admin email has necessary privileges

2. **Missing Users/Groups:**
   - Check Google Workspace group visibility settings
   - Verify user account status
   - Check naming strategy configuration

3. **Authentication Errors:**
   - Verify service account key
   - Check domain-wide delegation setup
   - Confirm admin email is correct

For more detailed information, refer to the [Backstage documentation](https://backstage.io/docs/integrations/google-workspace/org).
