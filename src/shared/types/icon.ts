import { Schema } from 'effect';

export const iconSchema = Schema.Struct({
  iconColor: Schema.Number,
  iconName: Schema.NonEmptyString,
});

export type IconValue = Schema.Schema.Type<typeof iconSchema>;
