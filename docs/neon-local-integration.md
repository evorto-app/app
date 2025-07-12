# Neon Local Integration

This document describes the integration of neon-local for running all integration tests.

## Overview

The application has been configured to use [neon-local](https://github.com/neondatabase-labs/neon_local) as a proxy service for running the complete integration test suite. Neon-local creates a local interface to your Neon cloud database and can automatically manage database branches, providing a consistent environment for all tests.

## Configuration

### Docker Compose

A `db` service has been added to `docker-compose.yml`:

```yaml
db:
  image: neondatabase/neon_local:latest
  container_name: neon-local
  ports:
    - '5432:5432'
  environment:
    NEON_API_KEY: ${NEON_API_KEY}
    NEON_PROJECT_ID: ${NEON_PROJECT_ID}
    DRIVER: postgres
    DELETE_BRANCH: "false"
```

### Environment Variables

The following environment variables are required and must be provided in your `.env` file:

- `NEON_API_KEY`: Your Neon API key (get from [Neon console](https://console.neon.tech/app/settings/api-keys))
- `NEON_PROJECT_ID`: Your Neon project ID (found in project settings)
- `DATABASE_URL`: Set to `postgres://neon:npg@localhost:5432/neondb` for neon-local

Create a `.env` file in the project root with these values:

```bash
NEON_API_KEY=your_neon_api_key_here
NEON_PROJECT_ID=your_project_id_here
DATABASE_URL=postgres://neon:npg@localhost:5432/neondb
```

### Database Configuration

The database client has been updated to configure the neon serverless driver for local development:

```typescript
// Configure neon-local for serverless driver when using local database
if (process.env['DATABASE_URL']?.includes('localhost:5432')) {
  neonConfig.fetchEndpoint = 'http://localhost:5432/sql';
}
```

## Usage

### Running All Integration Tests

To run the complete integration test suite with neon-local:

```bash
# Start the neon-local container
docker compose up db

# Run all integration tests
npm run e2e
```

This will run all tests including:
- Event creation and management tests
- Template functionality tests
- Database interaction tests
- User authentication tests
- And all other integration tests

### Running Specific Test Suites

You can also run specific test suites:

```bash
# Run only smoke tests
npm run e2e -- --grep "smoke"

# Run only event tests
npm run e2e -- --grep "events"

# Run only template tests
npm run e2e -- --grep "templates"
```

### Git Integration

For automatic branch management based on git branches, add volume mounts to the docker-compose.yml:

```yaml
db:
  # ... other configuration
  volumes:
    - ./.neon_local/:/tmp/.neon_local
    - ./.git/HEAD:/tmp/.git/HEAD:ro,consistent
```

Note: The `.neon_local/` directory is added to `.gitignore` to prevent committing connection metadata.

## Network Requirements

Neon-local requires internet connectivity to:
- Create and manage database branches via the Neon API
- Retrieve connection information for branches

In environments with network restrictions, you may need to:
- Configure proxy settings
- Allow outbound connections to `console.neon.tech`
- Use a pre-existing branch ID with the `BRANCH_ID` environment variable

## Troubleshooting

### Container Not Starting

If the neon-local container fails to start or create branches:

1. Check that environment variables are properly set
2. Verify internet connectivity from the container
3. Ensure the API key has proper permissions
4. Check container logs: `docker compose logs db`

### Connection Failures

If database connections fail:

1. Verify the container is running: `docker compose ps`
2. Check if the container is listening on port 5432: `docker compose exec db netstat -tlnp`
3. Verify the `neonConfig.fetchEndpoint` is set correctly for serverless driver

### Branch Creation Issues

If branch creation fails:

1. Check network connectivity to `console.neon.tech`
2. Verify API key permissions
3. Consider using a specific `BRANCH_ID` environment variable
4. Check if `DELETE_BRANCH` is set appropriately

## Testing

A test suite has been added to verify the neon-local integration:

```bash
# Run neon-local integration tests
npm run e2e -- --grep "Neon Local Integration"
```

## References

- [Neon Local Documentation](https://neon.tech/docs/local/neon-local)
- [Neon Local GitHub Repository](https://github.com/neondatabase-labs/neon_local)
- [Neon Serverless Driver](https://neon.tech/docs/serverless/serverless-driver)