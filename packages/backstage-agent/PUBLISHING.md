# Publishing Guide for @stratpoint/backstage-agent

This document describes how to publish the Backstage Agent package to npm.

## Prerequisites

1. **npm Account**: You must have an npm account with publish permissions for the `@stratpoint` organization
2. **Authentication**: Run `npm login` to authenticate with npm
3. **Organization Access**: Ensure you're a member of the `@stratpoint` organization on npm

## Publishing Steps

### 1. Prepare for Publishing

Update the version number in `package.json`:

```bash
# For patch releases (bug fixes)
npm version patch

# For minor releases (new features, backward compatible)
npm version minor

# For major releases (breaking changes)
npm version major
```

Or manually edit `package.json`:

```json
{
  "version": "0.2.0"
}
```

### 2. Build the Package

```bash
yarn clean
yarn build
```

Verify the build completed successfully:

```bash
ls -la dist/
```

### 3. Test the Package Locally

Create a tarball and verify contents:

```bash
npm pack --dry-run
```

Or create an actual tarball:

```bash
npm pack
```

This creates `stratpoint-backstage-agent-{version}.tgz`.

Test installation locally:

```bash
# In a different directory
npm install -g /path/to/stratpoint-backstage-agent-0.1.0.tgz

# Verify it works
backstage-agent --version
backstage-agent --help

# Uninstall after testing
npm uninstall -g @stratpoint/backstage-agent
```

### 4. Publish to npm

#### Option A: Standard Publish

```bash
npm publish
```

#### Option B: Publish with Access Control

For scoped packages (@stratpoint/...), specify access level:

```bash
# Public package (free, anyone can install)
npm publish --access public

# Restricted package (requires paid npm organization)
npm publish --access restricted
```

**For this package, use `--access public`** to allow open installation.

### 5. Verify Publication

Check that the package is published:

```bash
npm view @stratpoint/backstage-agent
```

Test installation from npm:

```bash
npm install -g @stratpoint/backstage-agent
backstage-agent --version
```

## Publishing Workflow

### Automated Publishing (GitHub Actions - Recommended)

Create `.github/workflows/publish.yml`:

```yaml
name: Publish to npm

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'

      - name: Install dependencies
        run: yarn install
        working-directory: ./packages/backstage-agent

      - name: Build
        run: yarn build
        working-directory: ./packages/backstage-agent

      - name: Publish to npm
        run: npm publish --access public
        working-directory: ./packages/backstage-agent
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

Add `NPM_TOKEN` to GitHub repository secrets:
1. Generate npm token: `npm token create`
2. Add to GitHub: Settings → Secrets → Actions → New repository secret
3. Name: `NPM_TOKEN`, Value: `npm_xxx...`

### Manual Publishing Steps

1. Update version in `package.json`
2. Update `CHANGELOG.md` with changes
3. Commit changes: `git commit -am "chore: release v0.2.0"`
4. Create git tag: `git tag v0.2.0`
5. Push to remote: `git push && git push --tags`
6. Build package: `yarn clean && yarn build`
7. Publish: `npm publish --access public`
8. Create GitHub release with release notes

## Version Guidelines

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (v1.0.0 → v2.0.0): Breaking changes
  - Changed CLI command structure
  - Removed/renamed configuration options
  - Changed API responses

- **MINOR** (v0.1.0 → v0.2.0): New features, backward compatible
  - Added new commands
  - Added new configuration options
  - Enhanced existing functionality

- **PATCH** (v0.1.0 → v0.1.1): Bug fixes, backward compatible
  - Fixed bugs
  - Documentation updates
  - Performance improvements

## Pre-release Versions

For testing before official release:

```bash
# Alpha release
npm version prerelease --preid=alpha
# Results in: 0.1.0-alpha.0

# Beta release
npm version prerelease --preid=beta
# Results in: 0.1.0-beta.0

# Publish with tag
npm publish --tag beta
```

Install pre-release:

```bash
npm install -g @stratpoint/backstage-agent@beta
```

## Deprecating Versions

If a version has issues:

```bash
npm deprecate @stratpoint/backstage-agent@0.1.0 "This version has a critical bug. Please upgrade to 0.1.1"
```

## Unpublishing (Emergency Only)

**Warning**: Only unpublish in emergencies (security issues, accidentally published secrets).

```bash
# Unpublish specific version (within 72 hours)
npm unpublish @stratpoint/backstage-agent@0.1.0

# Unpublish entire package (extreme cases only)
npm unpublish @stratpoint/backstage-agent --force
```

## Troubleshooting

### "You do not have permission to publish"

- Ensure you're logged in: `npm whoami`
- Check organization membership: Contact npm org admin
- Verify access level in `package.json`

### "Package name too similar to existing package"

- npm prevents package names that are too similar to existing ones
- Use a different name or contact npm support

### "Cannot publish over existing version"

- You cannot republish the same version
- Increment version number: `npm version patch`

### "Prepublish script failed"

- Check that `yarn clean && yarn build` runs successfully
- Ensure all TypeScript files compile without errors
- Verify all dependencies are installed

## Post-Publishing Checklist

- [ ] Verify package appears on npm: https://www.npmjs.com/package/@stratpoint/backstage-agent
- [ ] Test installation: `npm install -g @stratpoint/backstage-agent`
- [ ] Verify CLI works: `backstage-agent --version`
- [ ] Update documentation with new version
- [ ] Create GitHub release with changelog
- [ ] Announce in team channels
- [ ] Update Backstage deployment with new agent version

## Security Best Practices

1. **Never commit `.npmrc` with auth tokens**
2. **Use npm tokens with limited scope** (automation, publish-only)
3. **Enable 2FA on npm account** for publishing
4. **Rotate npm tokens regularly**
5. **Review `files` array in package.json** to avoid publishing sensitive files
6. **Use `.npmignore` to exclude development files**

## Support

For questions about publishing:
- npm docs: https://docs.npmjs.com/cli/v10/commands/npm-publish
- Organization access: Contact Stratpoint DevOps team
- Package issues: Open issue in GitHub repository
