# Neon Local Integration

This document describes the integration of neon-local for testing purposes.

## Overview

The application has been configured to use [neon-local](https://github.com/neondatabase-labs/neon_local) as a proxy service for testing. Neon-local creates a local interface to your Neon cloud database and can automatically manage database branches.

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

The following environment variables are required:

- `NEON_API_KEY`: Your Neon API key
- `NEON_PROJECT_ID`: Your Neon project ID
- `DATABASE_URL`: Set to `postgres://neon:npg@localhost:5432/neondb` for neon-local

### Database Configuration

The database client has been updated to configure the neon serverless driver for local development:

```typescript
// Configure neon-local for serverless driver when using local database
if (process.env['DATABASE_URL']?.includes('localhost:5432')) {
  neonConfig.fetchEndpoint = 'http://localhost:5432/sql';
}
```

## Usage

### Running Tests

To run tests with neon-local:

```bash
# Start the neon-local container
docker compose up db

# Run tests
npm run e2e
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