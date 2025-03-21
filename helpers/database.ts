import { seed as seedFalso } from '@ngneat/falso';
import consola from 'consola';

import { setupDatabase } from '../src/db/setup-database';

seedFalso('playwright'); // Set a consistent seed for falso
consola.info('Seeded falso');
setupDatabase().catch((error) => {
  console.error('Error setting up database:', error);
  process.exit(1);
});
