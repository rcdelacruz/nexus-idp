# Frontend Application

This is the React frontend for the task management application.

## Quick Start

```bash
# Using docker compose (recommended)
docker compose up

# Manual development
npm install
npm start
```

## Project Structure
```
frontend/
├── src/              # React source code
├── public/           # Static files
├── Dockerfile        # Production container
├── nginx.conf        # Nginx configuration
└── package.json      # Dependencies
```

## Nginx Configuration

We use Nginx to:
1. Serve the React application
2. Proxy API requests to the backend
3. Handle CORS and security headers
4. Manage caching and compression

### Key Features

1. **Static File Serving**
   ```nginx
   location / {
       try_files $uri $uri/ /index.html;
       expires 1h;
   }
   ```
   - Serves React app files
   - Handles client-side routing
   - Basic caching

2. **API Proxy**
   ```nginx
   location /api/ {
       proxy_pass http://backend:3000;
       # Headers and CORS configuration
   }
   ```
   - Forwards API requests to backend
   - Handles CORS headers
   - Manages WebSocket upgrades

3. **Security**
   ```nginx
   # Security headers
   add_header X-Frame-Options "SAMEORIGIN";
   add_header X-XSS-Protection "1; mode=block";
   add_header X-Content-Type-Options "nosniff";
   ```
   - Basic security headers
   - XSS protection
   - Frame protection

4. **Performance**
   ```nginx
   # Gzip compression
   gzip on;
   gzip_types text/plain text/css application/javascript;
   ```
   - Gzip compression
   - Static file caching
   - Performance headers

## Development

### Local Development
```bash
npm install
npm start
```
- Runs on http://localhost:3000
- Hot reloading enabled
- Direct API access

### Production Build
```bash
npm run build
```
- Creates optimized build
- Ready for Nginx serving
- Minified and compressed

## Docker Support

### Development
```bash
# Build image
docker build -t task-frontend .

# Run container
docker run -p 80:80 task-frontend
```

### Production
The Dockerfile:
1. Builds the React application
2. Copies to Nginx container
3. Configures Nginx serving

```dockerfile
# Build stage
FROM node:16-alpine as build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

## Environment Variables

Create a `.env` file:
```
REACT_APP_API_URL=http://localhost:3000/api
```

## Testing

```bash
# Run tests
npm test

# Coverage report
npm test -- --coverage
```

## Common Issues

### 1. API Connection
- Check nginx.conf proxy settings
- Verify backend service name
- Check CORS configuration

### 2. Build Issues
- Clear node_modules
- Verify environment variables
- Check nginx logs

### 3. Routing Issues
- Verify nginx try_files directive
- Check React Router setup
- Review nginx location blocks

## Support

Need help?
1. Check nginx logs
2. Review configuration
3. Ask during lab sessions

Remember: The frontend is configured to work with the provided backend API and will be served through Nginx in production.
