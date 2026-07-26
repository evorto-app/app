import { CanonicalIban } from '@shared/iban';
import { CanonicalEmailAddress } from '@shared/notification-email';
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

const OptionalCanonicalEmail = Schema.NullishOr(CanonicalEmailAddress).pipe(
  Schema.decodeTo(Schema.UndefinedOr(CanonicalEmailAddress), {
    decode: SchemaGetter.transform((value) => value ?? undefined),
    encode: SchemaGetter.transform((value) => value ?? null),
  }),
  Schema.withDecodingDefaultTypeKey(
    Effect.sync(function missingOptionalEmail(): undefined {
      return;
    }),
  ),
);

const OptionalCanonicalIban = Schema.NullishOr(CanonicalIban).pipe(
  Schema.decodeTo(Schema.UndefinedOr(CanonicalIban), {
    decode: SchemaGetter.transform((value) => value ?? undefined),
    encode: SchemaGetter.transform((value) => value ?? null),
  }),
  Schema.withDecodingDefaultTypeKey(
    Effect.sync(function missingOptionalIban(): undefined {
      return;
    }),
  ),
);

export class User extends Schema.Class<User>('User')({
  auth0Id: Schema.NonEmptyString,
  communicationEmail: CanonicalEmailAddress,
  email: Schema.NonEmptyString,
  firstName: Schema.NonEmptyString,
  homeTenantId: OptionalString,
  homeTenantName: OptionalString,
  iban: OptionalCanonicalIban,
  id: Schema.NonEmptyString,
  lastName: Schema.NonEmptyString,
  paypalEmail: OptionalCanonicalEmail,
  permissions: Schema.Array(PermissionSchema),
  roleIds: Schema.Array(Schema.NonEmptyString),
}) {}
