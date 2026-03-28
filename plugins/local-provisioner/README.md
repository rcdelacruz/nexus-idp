# Local Provisioner Frontend Plugin

This plugin provides a UI for managing local development resources provisioned from Backstage to developer machines.

## Features

- View all provisioning tasks assigned to your local agent
- Monitor agent status and health
- Track task execution history and logs
- Request new resource provisioning

## Installation

This plugin is already integrated into the Backstage app at `/local-provisioner`.

## Usage

1. **Install the Agent**: Follow the agent setup guide at `/docs/default/component/stratpoint-idp-portal/local-provisioner-setup`
2. **View Tasks**: Navigate to `/local-provisioner` to see your provisioning tasks
3. **Monitor Agent**: The agent status card shows connection status and health
4. **Create Resources**: Use training templates to provision local resources

## Architecture

This frontend plugin connects to the `@stratpoint/plugin-local-provisioner-backend` API endpoints:

- `GET /api/local-provisioner/tasks` - List user's tasks
- `GET /api/local-provisioner/tasks/:id` - Get task details
- `GET /api/local-provisioner/agent` - Get agent status
- `POST /api/local-provisioner/tasks` - Create new task

### Type System and Transformation Layer

This plugin follows **Backstage best practices** for API client design by implementing a **transformation layer** between backend and frontend types.

#### Why Two Type Systems?

**Backend API Types** (snake_case):
- Match database schema conventions
- Align with PostgreSQL column naming
- Follow backend/API standards
- Examples: `task_id`, `user_id`, `created_at`

**Frontend Types** (camelCase):
- Follow JavaScript/TypeScript conventions
- Align with React component props
- Improve developer experience
- Examples: `id`, `userId`, `createdAt`

#### How It Works

1. **Backend Types** (`src/api/types.ts`):
   - Defined with `Backend` prefix (e.g., `BackendProvisioningTask`)
   - Use snake_case field names
   - Represent exact API response structure

2. **Frontend Types** (`src/api/types.ts`):
   - Clean interfaces for components (e.g., `ProvisioningTask`)
   - Use camelCase field names
   - Optimized for React component usage

3. **Transformers** (`src/api/transformers.ts`):
   - Convert backend → frontend types
   - Handle field name transformations
   - Ensure type safety at boundaries

4. **API Client** (`src/api/LocalProvisionerClient.ts`):
   - Receives backend responses
   - Applies transformers
   - Returns frontend types to components

#### Example Flow

```typescript
// 1. Backend returns snake_case
const backendResponse = {
  tasks: [
    {
      task_id: "123",
      resource_name: "my-postgres",
      created_at: "2025-12-26T10:00:00Z"
    }
  ],
  total: 1
};

// 2. Transformer converts to camelCase
const frontendTasks = transformTasks(backendResponse.tasks);

// 3. Component receives camelCase
tasks.map(task => (
  <div>
    {task.id} - {task.resourceName} - {task.createdAt}
  </div>
));
```

#### Benefits

- **Type Safety**: Full TypeScript coverage with no `any` types
- **Separation of Concerns**: Backend schema doesn't leak into components
- **Maintainability**: Changes to backend don't require component updates
- **Best Practices**: Follows patterns from `@backstage/catalog-client`
- **Developer Experience**: Components use familiar JavaScript conventions

#### Key Files

- **Types**: `src/api/types.ts` (both backend and frontend types)
- **Transformers**: `src/api/transformers.ts` (transformation functions)
- **API Client**: `src/api/LocalProvisionerClient.ts` (handles transformation)
- **Components**: `src/components/*` (use frontend types only)

## Development

```bash
# Start plugin in isolation
yarn workspace @internal/plugin-local-provisioner start

# Run tests
yarn workspace @internal/plugin-local-provisioner test

# Build
yarn workspace @internal/plugin-local-provisioner build
```

### Adding New Fields

When adding new fields to the API:

1. **Update Backend Types** in `src/api/types.ts`:
   ```typescript
   export interface BackendProvisioningTask {
     // ... existing fields
     new_field_name: string; // snake_case
   }
   ```

2. **Update Frontend Types** in `src/api/types.ts`:
   ```typescript
   export interface ProvisioningTask {
     // ... existing fields
     newFieldName: string; // camelCase
   }
   ```

3. **Update Transformer** in `src/api/transformers.ts`:
   ```typescript
   export function transformTask(backendTask: BackendProvisioningTask): ProvisioningTask {
     return {
       // ... existing transformations
       newFieldName: backendTask.new_field_name,
     };
   }
   ```

4. **Use in Components**:
   ```typescript
   <Typography>{task.newFieldName}</Typography>
   ```
