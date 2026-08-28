# Backend Application Guide

## Overview
The backend is a Node.js/Express API that provides:
- RESTful API endpoints
- PostgreSQL database integration
- Error handling
- Input validation
- Health monitoring

## Project Structure
```
backend/
├── src/
│   ├── controllers/   # Request handlers
│   ├── models/       # Database models
│   ├── routes/       # API routes
│   ├── middleware/   # Custom middleware
│   └── server.js     # Main application
├── tests/            # Test files
├── Dockerfile        # Container configuration
└── package.json      # Dependencies and scripts
```

## API Endpoints

### Tasks API

#### GET /api/tasks
Get all tasks
```javascript
// Example response
[
  {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "title": "Complete project",
    "description": "Finish the documentation",
    "status": "IN_PROGRESS",
    "created_at": "2024-02-21T04:00:00.000Z",
    "updated_at": "2024-02-21T04:30:00.000Z"
  }
]
```

#### POST /api/tasks
Create a new task
```javascript
// Request body
{
  "title": "New task",
  "description": "Task description"
}

// Response
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "title": "New task",
  "description": "Task description",
  "status": "TODO",
  "created_at": "2024-02-21T04:00:00.000Z",
  "updated_at": "2024-02-21T04:00:00.000Z"
}
```

#### PUT /api/tasks/:id
Update a task
```javascript
// Request body
{
  "status": "DONE"
}

// Response
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "title": "New task",
  "description": "Task description",
  "status": "DONE",
  "created_at": "2024-02-21T04:00:00.000Z",
  "updated_at": "2024-02-21T05:00:00.000Z"
}
```

#### DELETE /api/tasks/:id
Delete a task
```javascript
// Response
{
  "message": "Task deleted successfully"
}
```

## Setup Instructions

### Local Development
```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env

# Start development server
npm run dev

# Run tests
npm test
```

### Environment Variables
Create a `.env` file:
```
NODE_ENV=development
PORT=3000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=taskdb
DB_USER=postgres
DB_PASSWORD=postgres
```

### Database Setup
```bash
# Create database
createdb taskdb

# Run migrations
npm run migrate up

# Seed data (if needed)
npm run seed
```

### Docker Build
```bash
# Build image
docker build -t task-manager-backend .

# Run container
docker run -p 3000:3000 \
  -e DB_HOST=host.docker.internal \
  task-manager-backend
```

## Implementation Details

### 1. Database Model (models/task.js)
```javascript
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Task = sequelize.define('Task', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT
    },
    status: {
      type: DataTypes.ENUM('TODO', 'IN_PROGRESS', 'DONE'),
      defaultValue: 'TODO'
    }
  });

  return Task;
};
```

### 2. API Routes (routes/tasks.js)
```javascript
const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');

router.get('/', taskController.getTasks);
router.post('/', taskController.createTask);
router.put('/:id', taskController.updateTask);
router.delete('/:id', taskController.deleteTask);

module.exports = router;
```

### 3. Error Handling (middleware/errorHandler.js)
```javascript
module.exports = (err, req, res, next) => {
  console.error(err.stack);

  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }

  res.status(500).json({ error: 'Something broke!' });
};
```

## Testing

### Unit Tests
```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test
npm test controllers/taskController.test.js
```

### Integration Tests
```bash
# Run integration tests
npm run test:integration
```

## Docker Configuration

### Dockerfile Explanation
```dockerfile
FROM node:16-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 3000

HEALTHCHECK --interval=30s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["npm", "start"]
```

## Development Guidelines

### 1. Code Organization
- Follow MVC pattern
- Use middleware for common operations
- Implement proper error handling
- Document API endpoints

### 2. Database
- Use migrations for schema changes
- Implement data validation
- Handle connection errors
- Use connection pooling

### 3. API Design
- Follow RESTful principles
- Use proper status codes
- Validate inputs
- Handle edge cases

### 4. Testing
- Write unit tests
- Implement integration tests
- Test error scenarios
- Maintain test coverage

## Common Issues

### 1. Database Connection
```javascript
// Test connection
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

pool.query('SELECT NOW()', (err, res) => {
  console.log(err ? err.stack : res.rows[0]);
});
```

### 2. Performance Issues
- Use connection pooling
- Implement caching
- Optimize queries
- Use proper indexes

### 3. Memory Leaks
- Monitor memory usage
- Clean up resources
- Use connection pools
- Implement proper error handling

## Production Considerations

### 1. Security
- Validate inputs
- Use proper error messages
- Implement rate limiting
- Set up CORS correctly

### 2. Performance
- Use clustering
- Implement caching
- Optimize database queries
- Monitor resource usage

### 3. Monitoring
- Set up logging
- Monitor performance
- Track errors
- Set up alerts

## Support

For issues or questions:
1. Check common issues section
2. Review error logs
3. Ask during lab sessions

Remember: This backend code is provided for you to focus on DevOps practices. The implementation is complete and tested - your task is to containerize and deploy it effectively.
