#!/bin/bash

# Neon Local Database Management Script for Evorto
# This script provides a local interface using Neon Local proxy service

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

# Function to check environment variables
check_env() {
    if [ -z "${NEON_API_KEY}" ]; then
        print_error "NEON_API_KEY environment variable is not set"
        exit 1
    fi
    if [ -z "${NEON_PROJECT_ID}" ]; then
        print_error "NEON_PROJECT_ID environment variable is not set"
        exit 1
    fi
}

# Function to start Neon Local
start_db() {
    print_status "Starting Neon Local database proxy..."
    check_docker
    check_env
    docker compose up -d db
    
    # Wait for Neon Local to be ready
    print_status "Waiting for Neon Local to be ready..."
    timeout 60 bash -c 'until nc -z localhost 5432; do sleep 1; done' || {
        print_error "Neon Local failed to start within 60 seconds"
        exit 1
    }
    
    print_status "Neon Local is ready!"
}

# Function to stop Neon Local
stop_db() {
    print_status "Stopping Neon Local database proxy..."
    docker compose down
    print_status "Neon Local stopped!"
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
    if docker ps | grep -q evorto-neon-local; then
        print_status "Neon Local is running"
        # Test connection to Neon Local
        if nc -z localhost 5432; then
            print_status "Connection to Neon Local successful"
        else
            print_warning "Neon Local container is running but not accepting connections"
        fi
    else
        print_warning "Neon Local is not running"
    fi
}

# Function to show logs
logs_db() {
    docker compose logs -f db
}

# Function to connect to database
connect_db() {
    print_status "Connecting to Neon Local database..."
    psql 'postgres://neon:npg@localhost:5432/neondb?sslmode=no-verify'
}

# Function to show help
show_help() {
    echo "Evorto Neon Local Database Management"
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  start     Start the Neon Local database proxy"
    echo "  stop      Stop the Neon Local database proxy"
    echo "  reset     Reset the local database (recreate schema and seed data)"
    echo "  status    Show Neon Local status"
    echo "  logs      Show Neon Local logs"
    echo "  connect   Connect to the database CLI"
    echo "  dev       Start Neon Local and run development server"
    echo "  help      Show this help message"
    echo ""
    echo "Environment Variables:"
    echo "  NEON_API_KEY        Your Neon API key (required)"
    echo "  NEON_PROJECT_ID     Your Neon Project ID (required)"
    echo "  DATABASE_URL_LOCAL  Local database connection string (default: postgres://neon:npg@localhost:5432/neondb)"
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