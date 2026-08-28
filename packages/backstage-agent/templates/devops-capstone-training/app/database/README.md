# Database Setup

This directory contains the PostgreSQL database setup for the task management application.

## Schema

The database has a single table for tasks:

```sql
CREATE TABLE tasks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'TODO',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Fields
- `id`: Unique identifier (UUID)
- `title`: Task title (required)
- `description`: Task details (optional)
- `status`: Current status (TODO, IN_PROGRESS, DONE)
- `created_at`: Creation timestamp
- `updated_at`: Last update timestamp

## Setup

The database is automatically initialized when you run:
```bash
docker compose up
```

This will:
1. Create the PostgreSQL container
2. Run the init.sql script
3. Create the table and indexes
4. Insert sample data

## Connection Details

Default configuration:
```
Host: localhost
Port: 5432
Database: taskdb
Username: postgres
Password: postgres
```

## Manual Setup (if needed)

```bash
# Create database
createdb taskdb

# Run initialization script
psql -d taskdb -f init.sql
```

## Sample Data

The initialization script includes some sample tasks:
1. "Complete frontend" (IN_PROGRESS)
2. "Set up database" (DONE)
3. "Write API endpoints" (TODO)

## Testing Connection

```bash
# Using psql
psql -h localhost -U postgres -d taskdb

# Inside psql
taskdb=# SELECT * FROM tasks;
```

Remember: The database setup is handled automatically by docker compose. You only need these details if you're running PostgreSQL locally.
