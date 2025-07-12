import { expect } from '@playwright/test';
import { test } from '../fixtures/base-test';

test.describe('Neon Local Integration', () => {
  test('should have neon-local configuration in place', async ({ }) => {
    // Log available environment variables for debugging
    console.log('Available env vars:', {
      DATABASE_URL: process.env['DATABASE_URL'],
      NEON_API_KEY: process.env['NEON_API_KEY'] ? 'SET' : 'NOT SET',
      NEON_PROJECT_ID: process.env['NEON_PROJECT_ID']
    });
    
    // Verify that neon-local environment variables are set
    expect(process.env['NEON_API_KEY']).toBeDefined();
    expect(process.env['NEON_PROJECT_ID']).toBeDefined();
    
    // Check if DATABASE_URL is configured for neon-local (may not be set in test environment)
    if (process.env['DATABASE_URL']) {
      expect(process.env['DATABASE_URL']).toContain('localhost:5432');
    }
  });

  test('should have neon serverless driver configured for local endpoint', async ({ }) => {
    // Import the neon config to check if it's properly configured
    const { neonConfig } = await import('@neondatabase/serverless');
    
    // When DATABASE_URL includes localhost:5432, neonConfig.fetchEndpoint should be set
    if (process.env['DATABASE_URL']?.includes('localhost:5432')) {
      expect(neonConfig.fetchEndpoint).toBe('http://localhost:5432/sql');
    } else {
      // This is expected in test environments where the full environment isn't loaded
      console.log('DATABASE_URL not set for localhost, skipping fetchEndpoint check');
    }
  });

  test('should have database fixture configured for neon-local', async ({ database }) => {
    // Verify that the database fixture is available
    expect(database).toBeDefined();
    expect(typeof database.execute).toBe('function');
  });
});