import { NeonHttpDatabase } from 'drizzle-orm/neon-http';

import * as schema from '../src/db/schema';
import { getId } from './get-id';

export const addIcons = (
  database: NeonHttpDatabase<typeof schema>,
  tenant: { id: string },
) => {
  return database
    .insert(schema.icons)
    .values([
      {
        commonName: 'alps',
        friendlyName: 'Alps',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'mountain',
        friendlyName: 'Mountain',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'beach',
        friendlyName: 'Beach',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'bus',
        friendlyName: 'Bus',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'city',
        friendlyName: 'City',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'beer',
        friendlyName: 'Beer',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'lake',
        friendlyName: 'Lake',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'village',
        friendlyName: 'Village',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'running',
        friendlyName: 'Running',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'suitcase',
        friendlyName: 'Suitcase',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'santa',
        friendlyName: 'Santa',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'munich-cathedral:color',
        friendlyName: 'Munich Cathedral',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'brandenburg-gate:color',
        friendlyName: 'Brandenburg Gate',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'bicycle',
        friendlyName: 'Bicycle',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'sled:color',
        friendlyName: 'Sled',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'alps',
        friendlyName: 'Alps',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'user-manual',
        friendlyName: 'User Manual',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'discount--v1',
        friendlyName: 'Discount',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'ticket--v1',
        friendlyName: 'Ticket',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'easy',
        friendlyName: 'Easy',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName: 'group-background-selected',
        friendlyName: 'Group Background Selected',
        id: getId(),
        tenantId: tenant.id,
      },
      {
        commonName:
          'external-canyon-landscape-vitaliy-gorbachev-flat-vitaly-gorbachev-1:external-vitaliy-gorbachev-flat-vitaly-gorbachev',
        friendlyName: 'Canyon Landscape',
        id: getId(),
        tenantId: tenant.id,
      },
    ])
    .returning();
};
