# How to Create and View Documentation in Backstage

## Step 1: Create Documentation Files

1. Create a new directory for your component:
```bash
mkdir -p docs/components/my-service
```

2. Create a `mkdocs.yml` file in your component directory:
```yaml
site_name: 'My Service'
nav:
  - Home: index.md
  - API: api.md
  - Deployment: deployment.md

plugins:
  - techdocs-core

markdown_extensions:
  - admonition
  - pymdownx.details
  - pymdownx.superfences
```

3. Create documentation pages:
   - `index.md` (main page)
   - `api.md` (API documentation)
   - `deployment.md` (deployment instructions)

## Step 2: Register in Catalog

Create a `catalog-info.yaml` file in your component directory:
```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: my-service
  description: My Service Documentation
  annotations:
    backstage.io/techdocs-ref: dir:.
spec:
  type: service
  lifecycle: production
  owner: engineering-team
```

## Step 3: View Documentation

1. Start Backstage:
```bash
yarn run dev
```

2. Navigate to your documentation:
   - Open Backstage in your browser (http://localhost:3000)
   - Click on "Catalog" in the sidebar
   - Find your component (my-service)
   - Click on the "Docs" tab

## Example Documentation Structure

```
docs/
├── components/
│   └── my-service/
│       ├── catalog-info.yaml
│       ├── mkdocs.yml
│       └── docs/
│           ├── index.md
│           ├── api.md
│           └── deployment.md
```

## Quick Start Example

1. Create a new service documentation:
```bash
# Create directories
mkdir -p docs/components/my-service/docs

# Create mkdocs.yml
cat > docs/components/my-service/mkdocs.yml << 'EOF'
site_name: 'My Service'
nav:
  - Home: index.md
plugins:
  - techdocs-core
EOF

# Create initial documentation
cat > docs/components/my-service/docs/index.md << 'EOF'
# My Service

## Overview
This is the documentation for My Service.

## Features
- Feature 1
- Feature 2
- Feature 3

## Getting Started
Instructions for getting started...
EOF

# Create catalog info
cat > docs/components/my-service/catalog-info.yaml << 'EOF'
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: my-service
  description: My Service Documentation
  annotations:
    backstage.io/techdocs-ref: dir:.
spec:
  type: service
  lifecycle: production
  owner: engineering-team
EOF
```

2. Add to Catalog Configuration:
Add this to your `app-config.yaml` under `catalog.locations`:
```yaml
    - type: file
      target: ../../docs/components/my-service/catalog-info.yaml
      rules:
        - allow: [Component]
```

3. View Documentation:
- Start Backstage (`yarn run dev`)
- Go to http://localhost:3000
- Navigate to Catalog
- Find "my-service"
- Click on "Docs" tab

## Tips for Writing Documentation

1. **Structure**
   - Start with an overview
   - Include getting started guide
   - Add detailed sections
   - Include examples

2. **Formatting**
   - Use headers for organization
   - Include code blocks
   - Add tables for structured data
   - Use lists for steps

3. **Best Practices**
   - Keep documentation up to date
   - Include diagrams when helpful
   - Add links to related resources
   - Use consistent formatting

## Troubleshooting

1. **Documentation Not Showing**
   - Check catalog-info.yaml is registered
   - Verify mkdocs.yml is properly formatted
   - Ensure techdocs-core plugin is listed

2. **Build Errors**
   - Check Python dependencies are installed
   - Verify file paths are correct
   - Look for syntax errors in markdown

3. **Missing Images**
   - Place images in docs/assets
   - Use relative paths
   - Check file permissions
