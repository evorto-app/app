import type { TemplateFindOneRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

export interface TemplateQuestionFormModel {
  description: string;
  registrationOptionKind: TemplateQuestionRegistrationOptionKind;
  required: boolean;
  title: string;
}

export type TemplateQuestionRegistrationOptionKind =
  | 'organizer'
  | 'participant';

export type TemplateQuestionSubmitData = Omit<
  TemplateQuestionFormModel,
  'description'
> & {
  description: null | string;
};

export const createTemplateQuestionFormModel = (
  overrides: Partial<TemplateQuestionFormModel> = {},
): TemplateQuestionFormModel => ({
  description: '',
  registrationOptionKind: 'participant',
  required: true,
  title: '',
  ...overrides,
});

export const toTemplateQuestionSubmitData = (
  question: TemplateQuestionFormModel,
): TemplateQuestionSubmitData => ({
  description: question.description.trim() || null,
  registrationOptionKind: question.registrationOptionKind,
  required: question.required,
  title: question.title.trim(),
});

export const templateQuestionOptionKindFromRecord = ({
  organizerRegistrationOptionId,
  participantRegistrationOptionId,
  question,
}: {
  organizerRegistrationOptionId: string | undefined;
  participantRegistrationOptionId: string | undefined;
  question: TemplateFindOneRecord['questions'][number];
}): TemplateQuestionRegistrationOptionKind => {
  if (
    organizerRegistrationOptionId &&
    question.registrationOptionId === organizerRegistrationOptionId
  ) {
    return 'organizer';
  }
  if (
    participantRegistrationOptionId &&
    question.registrationOptionId === participantRegistrationOptionId
  ) {
    return 'participant';
  }
  return 'participant';
};

export const templateQuestionRecordToFormModel = ({
  organizerRegistrationOptionId,
  participantRegistrationOptionId,
  question,
}: {
  organizerRegistrationOptionId: string | undefined;
  participantRegistrationOptionId: string | undefined;
  question: TemplateFindOneRecord['questions'][number];
}): TemplateQuestionFormModel =>
  createTemplateQuestionFormModel({
    description: question.description ?? '',
    registrationOptionKind: templateQuestionOptionKindFromRecord({
      organizerRegistrationOptionId,
      participantRegistrationOptionId,
      question,
    }),
    required: question.required,
    title: question.title,
  });
