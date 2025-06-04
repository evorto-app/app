return database
  .insert(schema.roles)
  .values([
    {
      description: 'Full app admins',
      id: getId(),
      name: 'Admin',
      permissions: ALL_PERMISSIONS,
      tenantId: tenant.id,
    },
    {
      defaultOrganizerRole: true,
      description: 'Members of the section',
      id: getId(),
      name: 'Section member',
      permissions: [
        'events:create',
        'events:edit',
        'events:seeDrafts',
        'events:viewPublic',
        'templates:view',
        'internal:viewInternalPages',
      ],
      tenantId: tenant.id,
    },
    {
      defaultOrganizerRole: true,
      description: 'Trial members of the section',
      id: getId(),
      name: 'Trial member',
      permissions: [
        'events:create',
        'events:viewPublic',
        'templates:view',
        'internal:viewInternalPages',
      ],
      tenantId: tenant.id,
    },
    {
      description: 'Helpers of the section',
      id: getId(),
      name: 'Helper',
      permissions: [
        'events:viewPublic',
        'templates:view',
        'internal:viewInternalPages',
      ],
      tenantId: tenant.id,
    },
    {
      defaultUserRole: true,
      description: 'Default role for all users',
      id: getId(),
      name: 'Regular user',
      permissions: ['events:viewPublic'],
      tenantId: tenant.id,
    },
  ])
  .returning();
