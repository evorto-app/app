import { Schema } from 'effect';

export class PlatformAdministratorAuthority extends Schema.Class<PlatformAdministratorAuthority>(
  'PlatformAdministratorAuthority',
)({
  actorEmail: Schema.NullOr(Schema.NonEmptyString),
  actorId: Schema.NonEmptyString,
  kind: Schema.Literal('platformAdministrator'),
}) {}
