import { getId } from './get-id';

export const defaultStateFile = 'e2e/.auth/default.json';
export const adminStateFile = 'e2e/.auth/admin-user.json';
export const gaStateFile = 'e2e/.auth/global-admin-user.json';
export const userStateFile = 'e2e/.auth/regular-user.json';
export const emptyStateFile = 'e2e/.auth/empty-user.json';

export const usersToAuthenticate = [
  {
    addToDb: true,
    addToTenant: true,
    authId: 'auth0|6775a3a47369b902878fdc74',
    email: 'testuser1@evorto.app',
    id: getId(),
    password: 'testpassword1!',
    roles: 'all' as const,
    stateFile: defaultStateFile,
  },
  {
    addToDb: true,
    addToTenant: true,
    authId: 'auth0|67af71761ad244799704e26f',
    email: 'admin@evorto.app',
    id: getId(),
    password: 'adminpassword1!',
    roles: 'admin' as const,
    stateFile: adminStateFile,
  },
  {
    addToDb: true,
    addToTenant: true,
    authId: 'auth0|67bb679215c6fbc625ca098f',
    email: 'global-admin@evorto.app',
    id: getId(),
    password: 'gapassword1!',
    roles: 'none' as const,
    stateFile: gaStateFile,
  },
  {
    addToDb: true,
    addToTenant: true,
    authId: 'auth0|67af71f31ad244799704e318',
    email: 'user@evorto.app',
    id: getId(),
    password: 'userpassword1!',
    roles: 'user' as const,
    stateFile: userStateFile,
  },
  {
    addToDb: true,
    addToTenant: true,
    authId: 'auth0|67af78dea8b5cb7c1a20d2e3',
    email: 'organizer@evorto.app',
    id: getId(),
    password: 'organizerpassword1!',
    roles: 'organizer' as const,
    stateFile: userStateFile,
  },
  {
    addToDb: true,
    addToTenant: true,
    authId: 'auth0|678e76939778438786fff634',
    email: 'testuser2@evorto.app',
    id: getId(),
    password: 'testpassword2!',
    roles: 'none' as const,
    stateFile: emptyStateFile,
  },
];
