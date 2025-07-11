# Local Database Setup for Evorto

This document describes how to set up and use the local PostgreSQL database for development and testing, providing a local interface similar to Neon Local.

## Overview

The local database setup provides:
- A PostgreSQL container running locally
- Same schema as the production Neon database
- Seeded test data for development
- Easy management scripts
- Automatic fallback to remote database when not in local mode

## Prerequisites

- Docker and Docker Compose
- Node.js and Yarn
- Environment configured in `.env.local`

## Quick Start

1. **Start the local database and development server:**
   ```bash
   yarn dev:local
   ```

2. **Or start components separately:**
   ```bash
   # Start local database only
   yarn db:local:up
   
   # Set up schema and seed data
   yarn db:local:reset
   
   # Start development server
   yarn start
   ```

## Environment Configuration

The local database uses these environment variables:

```env
# Local database connection (default if not set)
DATABASE_URL_LOCAL=postgresql://evorto:evorto_password@localhost:5432/evorto_local

# Enable local database mode
USE_LOCAL_DATABASE=true

# Remote database URL (fallback)
DATABASE_URL=your_neon_database_url
```

## Database Management Scripts

### Yarn Scripts

- `yarn db:local:up` - Start local PostgreSQL container
- `yarn db:local:down` - Stop local PostgreSQL container
- `yarn db:local:push` - Push schema to local database
- `yarn db:local:setup` - Seed local database with test data
- `yarn db:local:reset` - Reset local database (push schema + seed data)
- `yarn dev:local` - Start database and development server

### Management Script

Use the `scripts/local-db.sh` script for more detailed management:

```bash
# Start local database
./scripts/local-db.sh start

# Stop local database
./scripts/local-db.sh stop

# Reset database (recreate schema and seed data)
./scripts/local-db.sh reset

# Show database status
./scripts/local-db.sh status

# Show database logs
./scripts/local-db.sh logs

# Connect to database CLI
./scripts/local-db.sh connect

# Start database and development server
./scripts/local-db.sh dev
```

## Database Configuration

The application automatically detects which database to use:

1. **Local Database**: Used when `NODE_ENV=development` AND (`DATABASE_URL_LOCAL` is set OR `USE_LOCAL_DATABASE=true`)
2. **Remote Database**: Used otherwise (production, staging, or when local database is not configured)

## Local Database Details

- **Database**: `evorto_local`
- **User**: `evorto`
- **Password**: `evorto_password`
- **Port**: `5432`
- **Host**: `localhost` (or `postgres` when running in Docker)

## Troubleshooting

### Database Connection Issues

1. **Check if Docker is running:**
   ```bash
   docker info
   ```

2. **Check if database container is running:**
   ```bash
   docker ps | grep evorto-postgres
   ```

3. **Check database logs:**
   ```bash
   ./scripts/local-db.sh logs
   ```

### Port Already in Use

If port 5432 is already in use, you can change it in `docker-compose.yml`:

```yaml
postgres:
  ports:
    - "5433:5432"  # Change left side to different port
```

Then update your `DATABASE_URL_LOCAL` accordingly.

### Schema Issues

If the schema is out of sync, reset the database:

```bash
./scripts/local-db.sh reset
```

## Development Workflow

1. **Start local development:**
   ```bash
   yarn dev:local
   ```

2. **Make database changes:**
   - Update schema in `src/db/schema/`
   - Push changes: `yarn db:local:push`
   - Or reset with new data: `yarn db:local:reset`

3. **Test with seeded data:**
   - Local database comes with test data
   - Use `yarn db:local:setup` to refresh seed data

4. **Switch to remote database:**
   - Set `USE_LOCAL_DATABASE=false` in `.env.local`
   - Or comment out the variable
   - Restart the application

## Benefits of Local Database

- **Faster development**: No network latency
- **Offline development**: Work without internet connection
- **Isolated testing**: Changes don't affect other developers
- **Consistent data**: Deterministic seed data for testing
- **Easy reset**: Quickly restore to clean state
- **Schema experimentation**: Test migrations safely

## Docker Compose Services

The `docker-compose.yml` includes:

- **postgres**: Local PostgreSQL database
- **evorto**: Main application (depends on postgres)
- **stripe**: Stripe CLI for webhook testing

The postgres service includes:
- Health checks
- Data persistence via Docker volumes
- Automatic startup dependencies