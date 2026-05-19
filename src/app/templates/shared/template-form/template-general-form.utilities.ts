import type { IconValue } from '@shared/types/icon';

import { EventLocationType } from '../../../../types/location';

export interface TemplateGeneralFormModel {
  categoryId: string;
  description: string;
  icon: IconValue | null;
  location: EventLocationType | null;
  planningTips: string;
  title: string;
}

export type TemplateGeneralFormOverrides = Partial<TemplateGeneralFormModel>;

export const createTemplateGeneralFormModel = (
  overrides: TemplateGeneralFormOverrides = {},
): TemplateGeneralFormModel => ({
  categoryId: '',
  description: '',
  icon: null,
  location: null,
  planningTips: '',
  title: '',
  ...overrides,
});

export const mergeTemplateGeneralFormOverrides = (
  overrides: TemplateGeneralFormOverrides,
  previous?: TemplateGeneralFormModel,
): TemplateGeneralFormModel => {
  const base = previous ?? createTemplateGeneralFormModel();
  return createTemplateGeneralFormModel({
    categoryId: overrides.categoryId ?? base.categoryId,
    description: overrides.description ?? base.description,
    icon: overrides.icon === undefined ? base.icon : overrides.icon,
    location:
      overrides.location === undefined ? base.location : overrides.location,
    planningTips: overrides.planningTips ?? base.planningTips,
    title: overrides.title ?? base.title,
  });
};
