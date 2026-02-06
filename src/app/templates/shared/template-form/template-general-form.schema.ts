import { required, schema, validate } from '@angular/forms/signals';
import { hasTemporaryRichTextImageSources } from '@shared/utils/rich-text-media';

import { TemplateGeneralFormModel } from './template-general-form.utilities';

export const templateGeneralFormSchema = schema<TemplateGeneralFormModel>(
  (form) => {
    validate(form.description, ({ value }) => {
      return hasTemporaryRichTextImageSources(value())
        ? {
            kind: 'richTextPendingUpload',
            message: 'Wait for image uploads to finish before saving.',
          }
        : undefined;
    });
    required(form.categoryId);
    required(form.description);
    required(form.icon);
    required(form.title);
  },
);
