import { getId } from './get-id';

export const defaultStateFile = 'e2e/.auth/default.json';
export const newUserStateFile = 'e2e/.auth/new-user.json';

export const usersToAuthenticate = [
  {
    addToDb: true,
    addToTenant: true,
    authId: 'auth0|6775a3a47369b902878fdc74',
    email: 'testuser1@evorto.app',
    id: getId(),
    password: 'testpassword1!',
    stateFile: defaultStateFile,
  },
  // {
  //   addToDb: false,
  //   email: 'testuser2@evorto.app',
  //   password: 'testpassword2!',
  //   stateFile: newUserStateFile,
  //   userId: 'auth0|678e76939778438786fff634',
  // },
];
