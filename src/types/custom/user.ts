import { Effect, Schema, SchemaGetter } from 'effect';

import { PermissionSchema } from '../../shared/permissions/permissions';

const OptionalString = Schema.NullishOr(Schema.NonEmptyString).pipe(
  Schema.decodeTo(Schema.UndefinedOr(Schema.NonEmptyString), {
    decode: SchemaGetter.transform((value) => value ?? undefined),
    encode: SchemaGetter.transform((value) => value ?? null),
  }),
  Schema.withDecodingDefaultTypeKey(
    Effect.sync(function missingOptionalString(): undefined {
      return;
    }),
  ),
);

export class User extends Schema.Class<User>('User')({
  attributes: Schema.Array(Schema.Literal('events:organizesSome')),
  auth0Id: Schema.NonEmptyString,
  email: Schema.NonEmptyString,
  firstName: Schema.NonEmptyString,
  iban: OptionalString,
  id: Schema.NonEmptyString,
  lastName: Schema.NonEmptyString,
  paypalEmail: OptionalString,
  permissions: Schema.Array(PermissionSchema),
  roleIds: Schema.Array(Schema.NonEmptyString),
}) {}
