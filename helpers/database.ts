import { setupDatabase } from '../src/db/setup-database';

setupDatabase().catch((error) => {
  console.error('Error setting up database:', error);
  process.exit(1);
});
