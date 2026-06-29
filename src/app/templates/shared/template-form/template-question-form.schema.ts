import { required, schema } from '@angular/forms/signals';

import { TemplateQuestionFormModel } from './template-question-form.utilities';

export const templateQuestionFormSchema = schema<TemplateQuestionFormModel>(
  (form) => {
    required(form.registrationOptionKind);
    required(form.title);
  },
);
