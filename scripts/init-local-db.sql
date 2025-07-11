-- Database initialization script for local PostgreSQL
-- This script sets up the necessary extensions and functions to match Neon's environment

-- Enable unaccent extension for accent-insensitive text search
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Enable pg_trgm extension for trigram-based text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create immutable_unaccent function to match Neon's behavior
CREATE OR REPLACE FUNCTION immutable_unaccent(varchar)
  RETURNS text AS $$
    SELECT unaccent($1)
  $$ LANGUAGE sql IMMUTABLE;

-- Create any other extensions that might be needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";