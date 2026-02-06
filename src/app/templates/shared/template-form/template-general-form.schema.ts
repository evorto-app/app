import { required, schema } from '@angular/forms/signals';

import { TemplateGeneralFormModel } from './template-general-form.utilities';

export const templateGeneralFormSchema = schema<TemplateGeneralFormModel>(
  (form) => {
    required(form.categoryId);
    required(form.description);
    required(form.icon);
    required(form.title);
  },
);
