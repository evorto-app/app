import { Schema } from 'effect';

export const literalUnion = <
  const Values extends readonly [string, ...string[]],
>(
  ...values: Values
) => Schema.Literals(values);

export const nonNegativeNumber = Schema.Number.check(
  Schema.isGreaterThanOrEqualTo(0),
);

export const positiveNumber = Schema.Number.check(Schema.isGreaterThan(0));

export const optionalNullable = <S extends Schema.Top>(schema: S) =>
  Schema.optional(Schema.NullOr(schema));

export const extendStruct = <
  BaseFields extends Schema.Struct.Fields,
  ExtensionFields extends Schema.Struct.Fields,
>(
  base: Schema.Struct<BaseFields>,
  extension: Schema.Struct<ExtensionFields>,
) =>
  Schema.Struct({
    ...base.fields,
    ...extension.fields,
  } as BaseFields & ExtensionFields);

export const pickStruct = <
  Fields extends Schema.Struct.Fields,
  const Keys extends readonly (keyof Fields)[],
>(
  source: Schema.Struct<Fields>,
  keys: Keys,
) =>
  Schema.Struct(
    Object.fromEntries(keys.map((key) => [key, source.fields[key]])) as Pick<
      Fields,
      Keys[number]
    >,
  );
