#!/bin/bash

# Local Database Management Script for Evorto
# This script provides a local interface for testing similar to Neon Local

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        print_error "Docker is not running. Please start Docker first."
        exit 1
    fi
}

# Function to start local database
start_db() {
    print_status "Starting local PostgreSQL database..."
    check_docker
    docker compose up -d postgres
    
    # Wait for database to be ready
    print_status "Waiting for database to be ready..."
    timeout 30 bash -c 'until docker exec evorto-postgres pg_isready -U evorto -d evorto_local; do sleep 1; done' || {
        print_error "Database failed to start within 30 seconds"
        exit 1
    }
    
    print_status "Local database is ready!"
}

# Function to stop local database
stop_db() {
    print_status "Stopping local PostgreSQL database..."
    docker compose down
    print_status "Local database stopped!"
}

# Function to reset local database
reset_db() {
    print_status "Resetting local database..."
    export USE_LOCAL_DATABASE=true
    yarn db:local:push
    npx tsx helpers/local-database-setup.ts
    print_status "Local database reset complete!"
}

# Function to show database status
status_db() {
    if docker ps | grep -q evorto-postgres; then
        print_status "Local database is running"
        docker exec evorto-postgres psql -U evorto -d evorto_local -c "SELECT 'Database connection successful' as status;"
    else
        print_warning "Local database is not running"
    fi
}

# Function to show logs
logs_db() {
    docker compose logs -f postgres
}

# Function to connect to database
connect_db() {
    print_status "Connecting to local database..."
    docker exec -it evorto-postgres psql -U evorto -d evorto_local
}

# Function to show help
show_help() {
    echo "Evorto Local Database Management"
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  start     Start the local PostgreSQL database"
    echo "  stop      Stop the local PostgreSQL database"
    echo "  reset     Reset the local database (recreate schema and seed data)"
    echo "  status    Show database status"
    echo "  logs      Show database logs"
    echo "  connect   Connect to the database CLI"
    echo "  dev       Start database and run development server"
    echo "  help      Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  DATABASE_URL_LOCAL  Local database connection string (default: postgresql://evorto:evorto_password@localhost:5432/evorto_local)"
    echo "  USE_LOCAL_DATABASE  Set to 'true' to use local database (default: true in development)"
}

# Main command handler
case "${1:-help}" in
    "start")
        start_db
        ;;
    "stop")
        stop_db
        ;;
    "reset")
        reset_db
        ;;
    "status")
        status_db
        ;;
    "logs")
        logs_db
        ;;
    "connect")
        connect_db
        ;;
    "dev")
        start_db
        reset_db
        print_status "Starting development server..."
        yarn start
        ;;
    "help"|*)
        show_help
        ;;
esac