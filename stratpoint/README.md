# Stratpoint Backstage Catalog

This directory contains the organizational structure, systems, and components for the Stratpoint Backstage instance.

**Note**: Software templates are maintained in a separate repository:
**https://github.com/stratpoint-engineering/engineering-standards.git**

## Directory Structure

```
stratpoint/
├── catalog-info.yaml          # Root catalog entry point
├── README.md                  # This file
├── org/                       # Organization structure
│   ├── groups.yaml           # Teams, departments, and groups
│   └── users.yaml            # Individual users
├── systems/                   # System definitions
│   └── internal-platform.yaml
└── components/                # Component catalog
    └── stratpoint-idp-portal.yaml
```

## Templates Repository

Software templates, scaffolders, and project standards are maintained separately in:
- **Repository**: https://github.com/stratpoint-engineering/engineering-standards.git
- **Purpose**: Centralized project templates, coding standards, and scaffolding definitions
- **Integration**: Loaded via `catalog.locations` in `app-config.yaml`

## Organization Structure

### Hierarchy

```
Stratpoint Solutions (stratpoint)
├── Engineering Department (engineering-dept)
│   ├── Frontend Team (frontend-team)
│   ├── Backend Team (backend-team)
│   └── DevOps Team (devops-team)
├── Product Department (product-dept)
│   ├── Design Team (design-team)
│   └── Product Management (pm-team)
└── Backstage Admins (backstage-admins)
```

## Adding New Entities

### Adding a New User

Edit `org/users.yaml` and add:

```yaml
---
apiVersion: backstage.io/v1alpha1
kind: User
metadata:
  name: firstname.lastname
  description: Job Title
spec:
  profile:
    email: firstname.lastname@stratpoint.com
    displayName: Firstname Lastname
  memberOf: [team-name]
```

### Adding a New Team

Edit `org/groups.yaml` and add:

```yaml
---
apiVersion: backstage.io/v1alpha1
kind: Group
metadata:
  name: new-team
  description: Team Description
spec:
  type: team
  profile:
    displayName: New Team
    email: team@stratpoint.com
  parent: engineering-dept  # or product-dept
  children: []
```

### Adding a New Component

Create a new file in `components/` directory:

```yaml
---
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: my-service
  description: Service description
  annotations:
    github.com/project-slug: stratpoint/my-repo
spec:
  type: service
  lifecycle: production
  owner: backend-team
  system: internal-developer-platform
```

### Adding a New System

Create a new file in `systems/` directory:

```yaml
---
apiVersion: backstage.io/v1alpha1
kind: System
metadata:
  name: my-system
  description: System description
spec:
  owner: devops-team
  domain: platform-engineering
```

## Permissions

The following groups have special permissions:

- **backstage-admins**: Full administrative access to Backstage
- All authenticated users: Can create entities and use templates
- Regular users: Read-only access to catalog

## Automatic User Provisioning

For automated user provisioning from Google Workspace or LDAP, see the main [README.md](../README.md) in the project root.
