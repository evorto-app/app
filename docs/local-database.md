# Neon Local Database Setup for Evorto

This document describes how to set up and use Neon Local for development and testing, providing a local interface to your Neon cloud database.

## Overview

The Neon Local setup provides:
- A local proxy service to your Neon cloud database
- Automatic branch creation and management
- Same schema as the production Neon database
- Git branch integration for persistent database branches
- Easy management scripts
- Automatic fallback to remote database when not in local mode

## Prerequisites

- Docker and Docker Compose
- Node.js and Yarn
- Neon API key and Project ID
- Environment configured in `.env.local`

## Quick Start

1. **Set up your environment variables:**
   ```bash
   # In your .env.local file
   NEON_API_KEY=your_neon_api_key
   NEON_PROJECT_ID=your_neon_project_id
   ```

2. **Start the Neon Local proxy and development server:**
   ```bash
   yarn dev:local
   ```

3. **Or start components separately:**
   ```bash
   # Start Neon Local proxy only
   yarn db:local:up
   
   # Set up schema and seed data
   yarn db:local:reset
   
   # Start development server
   yarn start
   ```

## Environment Configuration

The Neon Local setup uses these environment variables:

```env
# Neon Local connection (default if not set)
DATABASE_URL_LOCAL=postgres://neon:npg@localhost:5432/neondb?sslmode=no-verify

# Enable local database mode
USE_LOCAL_DATABASE=true

# Neon API credentials (required)
NEON_API_KEY=your_neon_api_key
NEON_PROJECT_ID=your_neon_project_id

# Remote database URL (fallback)
DATABASE_URL=your_neon_database_url
```

## Database Management Scripts

### Yarn Scripts

- `yarn db:local:up` - Start Neon Local proxy container
- `yarn db:local:down` - Stop Neon Local proxy container
- `yarn db:local:push` - Push schema to Neon Local database
- `yarn db:local:setup` - Seed Neon Local database with test data
- `yarn db:local:reset` - Reset Neon Local database (push schema + seed data)
- `yarn dev:local` - Start Neon Local proxy and development server

### Management Script

Use the `scripts/local-db.sh` script for more detailed management:

```bash
# Start Neon Local proxy
./scripts/local-db.sh start

# Stop Neon Local proxy
./scripts/local-db.sh stop

# Reset database (recreate schema and seed data)
./scripts/local-db.sh reset

# Show Neon Local status
./scripts/local-db.sh status

# Show Neon Local logs
./scripts/local-db.sh logs

# Connect to database CLI
./scripts/local-db.sh connect

# Start Neon Local proxy and development server
./scripts/local-db.sh dev
```

## Database Configuration

The application automatically detects which database to use:

1. **Local Database**: Used when `NODE_ENV=development` AND (`DATABASE_URL_LOCAL` is set OR `USE_LOCAL_DATABASE=true`)
2. **Remote Database**: Used otherwise (production, staging, or when local database is not configured)

## Neon Local Details

- **Connection**: `postgres://neon:npg@localhost:5432/neondb`
- **Port**: `5432`
- **Host**: `localhost` (or `db` when running in Docker)
- **Branch Management**: Automatically creates and deletes branches
- **Git Integration**: Persistent branches per Git branch

## Troubleshooting

### Neon Local Connection Issues

1. **Check if Docker is running:**
   ```bash
   docker info
   ```

2. **Check if Neon Local container is running:**
   ```bash
   docker ps | grep evorto-neon-local
   ```

3. **Check Neon Local logs:**
   ```bash
   ./scripts/local-db.sh logs
   ```

4. **Verify environment variables are set:**
   ```bash
   echo $NEON_API_KEY
   echo $NEON_PROJECT_ID
   ```

### Port Already in Use

If port 5432 is already in use, you can change it in `docker-compose.yml`:

```yaml
db:
  ports:
    - "5433:5432"  # Change left side to different port
```

Then update your `DATABASE_URL_LOCAL` accordingly.

### API Key Issues

If you're getting authentication errors:

1. **Verify your Neon API key:**
   - Go to [Neon Console](https://console.neon.tech/)
   - Navigate to Account Settings > API Keys
   - Generate a new API key if needed

2. **Check your Project ID:**
   - Go to your project in Neon Console
   - Find Project ID in Settings > General

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