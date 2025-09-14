# E2E Testing Guide

## Current Status ✅

E2E tests are now **working successfully** with the following setup approach.

## Working Setup (Recommended)

### Method 1: Angular Dev Server + E2E Tests
This is the **currently working** and recommended approach:

1. **Start Angular Development Server:**
   ```bash
   yarn start
   ```
   - Server will be available at `http://localhost:4200`
   - Wait for build to complete (~20-30 seconds)

2. **Run E2E Tests (in separate terminal):**
   ```bash
   NO_WEBSERVER=true yarn e2e
   ```

### Test Results
- ✅ **Authentication Setup**: Working with `ignoreHTTPSErrors: true` in Playwright config
- ✅ **Database Connectivity**: Successfully connects to `ep-aged-hat-a9sgkb7v.gwc.azure.neon.tech`
- ✅ **Auth0 Integration**: Working with `tumi-dev.eu.auth0.com`
- ✅ **Canvas Dependencies**: Successfully migrated to `skia-canvas` (no native dependencies)

## Current Docker Issues ❌

### Method 2: Docker Setup (Currently Blocked)
The Docker approach has network connectivity issues:

**Problem:** FontAwesome Pro registry (`npm.fontawesome.com`) is not accessible during Docker builds, causing:
```
Error: connect ETIMEDOUT 104.16.168.120:443
```

**Dependencies blocking Docker builds:**
- `@fortawesome/angular-fontawesome` requires access to private FontAwesome registry
- Registry connection timeouts prevent `yarn install` from completing

**Attempted Solutions:**
1. ✅ Removed Alpine native dependencies (cairo, pango, etc.)
2. ✅ Migrated from `canvas` to `skia-canvas` for cross-platform compatibility
3. ❌ Cannot resolve FontAwesome registry connectivity in Docker environment

## Key Configuration Changes Made

### 1. Playwright Configuration
```typescript
// playwright.config.ts
use: {
  // Ignore SSL errors when connecting to Auth0 and other external services
  ignoreHTTPSErrors: true,
}
```

### 2. Canvas Dependencies Migration
- **Replaced:** `canvas` → `skia-canvas`
- **Benefit:** No native dependencies required (Alpine packages removed)
- **Compatibility:** Same Canvas 2D API interface maintained

### 3. Angular Build Configuration
```json
// angular.json
"externalDependencies": ["skia-canvas"]
```

## Network Requirements

The following domains must be accessible:
- ✅ `tumi-dev.eu.auth0.com` (Auth0 authentication)
- ✅ `ep-aged-hat-a9sgkb7v.gwc.azure.neon.tech` (Neon database)
- ❌ `npm.fontawesome.com` (FontAwesome Pro registry - Docker only)

## Recommendations

### For Current Development
1. **Use Method 1** (Angular dev server + e2e tests) for reliable testing
2. **Ensure firewall access** to Auth0 and database domains
3. **Run tests with:** `NO_WEBSERVER=true yarn e2e`

### For Future Docker Support
To resolve Docker issues, consider:

1. **Option A:** Replace FontAwesome Pro with open-source alternative
2. **Option B:** Use local FontAwesome Pro package cache/proxy
3. **Option C:** Build Docker images in environment with FontAwesome registry access

### Test Execution Commands

```bash
# Working approach
yarn start &
sleep 30
NO_WEBSERVER=true yarn e2e

# Docker approach (currently blocked)
yarn docker:start  # Fails on FontAwesome registry timeout
```

## Performance Notes

- **Angular build time:** ~20-30 seconds
- **E2E test execution:** ~2-3 minutes for full suite
- **Database seeding:** Happens automatically during tests
- **Canvas icon processing:** Now works cross-platform with skia-canvas

## Troubleshooting

### If tests fail with SSL errors:
- Verify `ignoreHTTPSErrors: true` is set in playwright.config.ts

### If authentication tests timeout:
- Check Auth0 domain accessibility
- Verify database connectivity
- Ensure server is running on port 4200

### If Docker build fails:
- FontAwesome registry connectivity issue (known limitation)
- Use dev server approach instead