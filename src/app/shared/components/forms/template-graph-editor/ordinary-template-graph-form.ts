import type {
  TemplateGraphInput,
  TemplateGraphRecord,
} from '@shared/rpc-contracts/app-rpcs/templates.rpcs';
import type { IconValue } from '@shared/types/icon';

import {
  createTemplateGeneralFormModel,
  type TemplateGeneralFormModel,
} from '../../../../templates/shared/template-form/template-general-form.utilities';
import {
  templateGraphFormToPayload,
  templateGraphLocationValueToFormModel,
  templateGraphRecordToFormModel,
} from './template-graph-form.mapper';
import {
  createTemplateGraphFormModel,
  type TemplateGraphAddonFormModel,
  type TemplateGraphQuestionFormModel,
  type TemplateGraphRegistrationOptionFormModel,
} from './template-graph-form.model';

export type OrdinaryTemplateGraphFormLoadResult =
  { error: string } | { model: OrdinaryTemplateGraphFormModel };

export interface OrdinaryTemplateGraphFormModel extends TemplateGeneralFormModel {
  addOns: TemplateGraphAddonFormModel[];
  questions: TemplateGraphQuestionFormModel[];
  registrationOptions: TemplateGraphRegistrationOptionFormModel[];
  simpleModeEnabled: boolean;
  unlisted: boolean;
}

export type OrdinaryTemplateGraphSubmitModel = Omit<
  OrdinaryTemplateGraphFormModel,
  'icon'
> & {
  icon: IconValue;
};

export const createOrdinaryTemplateGraphFormModel = (
  overrides: Partial<OrdinaryTemplateGraphFormModel> = {},
): OrdinaryTemplateGraphFormModel => {
  const general = createTemplateGeneralFormModel();
  const graph = createTemplateGraphFormModel();
  return {
    ...general,
    addOns: graph.addOns,
    questions: graph.questions,
    registrationOptions: graph.registrationOptions,
    simpleModeEnabled: true,
    unlisted: false,
    ...overrides,
  };
};

export const ordinaryTemplateGraphRecordToFormModel = (
  template: TemplateGraphRecord,
): OrdinaryTemplateGraphFormLoadResult => {
  const graphResult = templateGraphRecordToFormModel(template);
  if ('error' in graphResult) return graphResult;

  return {
    model: createOrdinaryTemplateGraphFormModel({
      addOns: graphResult.model.addOns,
      categoryId: template.categoryId,
      description: template.description,
      icon: template.icon,
      location: template.location,
      planningTips: template.planningTips ?? '',
      questions: graphResult.model.questions,
      registrationOptions: graphResult.model.registrationOptions,
      simpleModeEnabled: template.simpleModeEnabled,
      title: template.title,
      unlisted: template.unlisted,
    }),
  };
};

export const ordinaryTemplateGraphFormToPayload = (
  model: OrdinaryTemplateGraphSubmitModel,
  esnCardEnabled: boolean,
): TemplateGraphInput =>
  templateGraphFormToPayload(
    {
      addOns: model.addOns,
      categoryId: model.categoryId,
      description: model.description,
      iconColor: model.icon.iconColor,
      iconName: model.icon.iconName,
      location: templateGraphLocationValueToFormModel(model.location),
      planningTips: model.planningTips,
      questions: model.questions,
      registrationOptions: model.registrationOptions,
      simpleModeEnabled: model.simpleModeEnabled,
      title: model.title,
      unlisted: model.unlisted,
    },
    esnCardEnabled,
  );
