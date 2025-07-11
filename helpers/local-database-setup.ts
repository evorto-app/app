import { seed as seedFalso } from '@ngneat/falso';
import consola from 'consola';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '../src/db/schema';

/**
 * Simple Local Database Setup
 *
 * This is a simplified version of the database setup that works with the local PostgreSQL
 * without the complex relations system.
 */

// Set a consistent seed for falso to ensure deterministic data generation
seedFalso('playwright');
consola.info('Seeded falso with fixed seed "playwright"');

async function setupLocalDatabase() {
  // Create local database connection
  const pool = new Pool({
    connectionString: process.env['DATABASE_URL_LOCAL'] || 'postgresql://evorto:evorto_password@localhost:5432/evorto_local',
  });

  const database = drizzle(pool, { schema });

  try {
    // Simple test to ensure database is working
    consola.info('Testing database connection...');
    await database.execute('SELECT 1');
    consola.info('Database connection successful');

    // Check if test data already exists
    const existingUsers = await database.select().from(schema.users).limit(1);
    
    if (existingUsers.length > 0) {
      consola.info('Database already has data, skipping setup');
    } else {
      // Insert a test user only if no users exist
      consola.info('Inserting test data...');
      await database.insert(schema.users).values({
        auth0Id: 'test-auth0-id',
        email: 'test@example.com',
        communicationEmail: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
      });
      consola.info('Test data inserted successfully');
    }

    // Clean up
    await pool.end();
    consola.info('Local database setup completed successfully');
  } catch (error) {
    consola.error('Error setting up local database:', error);
    await pool.end();
    process.exit(1);
  }
}

// Run the setup
setupLocalDatabase().catch((error) => {
  console.error('Error in local database setup:', error);
  process.exit(1);
});