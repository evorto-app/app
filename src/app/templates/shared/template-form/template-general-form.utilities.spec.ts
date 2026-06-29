import { describe, expect, it } from 'vitest';

import {
  createTemplateGeneralFormModel,
  mergeTemplateGeneralFormOverrides,
} from './template-general-form.utilities';

describe('template general form utilities', () => {
  it('initializes organizer planning tips as blank private notes', () => {
    expect(createTemplateGeneralFormModel().planningTips).toBe('');
  });

  it('preserves organizer planning tips when merging partial overrides', () => {
    expect(
      mergeTemplateGeneralFormOverrides(
        { title: 'Updated template' },
        createTemplateGeneralFormModel({
          planningTips: 'Bring printed waiver forms.',
          title: 'Original template',
        }),
      ),
    ).toMatchObject({
      planningTips: 'Bring printed waiver forms.',
      title: 'Updated template',
    });
  });
});
