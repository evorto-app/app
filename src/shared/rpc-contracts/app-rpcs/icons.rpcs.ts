import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { IconRpcError } from './icons.errors';

const icons8SegmentPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const isValidIcons8IconName = (value: string): boolean => {
  if (value.length === 0 || value.length > 128) return false;

  const segments = value.split(':');
  return (
    segments.length <= 2 &&
    segments.every(
      (segment) => segment.length <= 96 && icons8SegmentPattern.test(segment),
    )
  );
};

export const Icons8IconName = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) =>
      isValidIcons8IconName(value)
        ? undefined
        : 'Expected a normalized lowercase Icons8 name with one optional style',
    ),
  ),
);

export class CategoryManagementIconUsage extends Schema.TaggedClass<CategoryManagementIconUsage>()(
  'categoryManagement',
  {},
) {}

export class EventCreateIconUsage extends Schema.TaggedClass<EventCreateIconUsage>()(
  'eventCreate',
  {},
) {}

export class EventEditIconUsage extends Schema.TaggedClass<EventEditIconUsage>()(
  'eventEdit',
  { eventId: Schema.NonEmptyString },
) {}

export class TemplateCreateIconUsage extends Schema.TaggedClass<TemplateCreateIconUsage>()(
  'templateCreate',
  {},
) {}

export class TemplateEditIconUsage extends Schema.TaggedClass<TemplateEditIconUsage>()(
  'templateEdit',
  { templateId: Schema.NonEmptyString },
) {}

export const IconAddUsage = Schema.Union([
  EventCreateIconUsage,
  EventEditIconUsage,
  TemplateCreateIconUsage,
  TemplateEditIconUsage,
  CategoryManagementIconUsage,
]);

export type IconAddUsage = Schema.Schema.Type<typeof IconAddUsage>;

export const IconRecord = Schema.Struct({
  commonName: Schema.NonEmptyString,
  friendlyName: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  sourceColor: Schema.NullOr(Schema.Number),
});

export type IconRecord = Schema.Schema.Type<typeof IconRecord>;

export const IconSearchInput = Schema.Struct({
  search: Schema.String.check(Schema.isMaxLength(64)),
});

export const IconsSearch = asRpcQuery(
  Rpc.make('icons.search', {
    error: IconRpcError,
    payload: IconSearchInput,
    success: Schema.Array(IconRecord),
  }),
);

export const IconsAdd = asRpcMutation(
  Rpc.make('icons.add', {
    error: IconRpcError,
    payload: Schema.Struct({ icon: Icons8IconName, usage: IconAddUsage }),
    success: IconRecord,
  }),
);

export class IconsRpcs extends RpcGroup.make(IconsSearch, IconsAdd) {}
