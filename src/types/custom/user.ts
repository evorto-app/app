import { Schema } from 'effect';

export class User extends Schema.Class<User>('User')({
  auth0Id: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
}) {}
