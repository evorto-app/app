import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  templateAddOnCopyNotice,
  templateCreateEventSubmitDisabled,
} from './template-create-event.component';

const templateCreateEventTemplate = (): string =>
  readFileSync(
    nodePath.join(
      process.cwd(),
      'src/app/templates/template-create-event/template-create-event.component.html',
    ),
    'utf8',
  );

describe('templateCreateEventSubmitDisabled', () => {
  it('blocks template event creation while invalid, submitting, or awaiting the mutation', () => {
    expect(
      templateCreateEventSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(false);
    expect(
      templateCreateEventSubmitDisabled({
        formInvalid: true,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      templateCreateEventSubmitDisabled({
        formInvalid: false,
        formSubmitting: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      templateCreateEventSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: true,
      }),
    ).toBe(true);
  });
});

describe('templateAddOnCopyNotice', () => {
  it('stays hidden when a template has no reusable add-ons', () => {
    expect(templateAddOnCopyNotice(0)).toBeNull();
  });

  it('keeps the create-event add-on boundary explicit', () => {
    expect(templateAddOnCopyNotice(1)).toContain(
      'This template has 1 reusable add-on.',
    );
    expect(templateAddOnCopyNotice(2)).toContain(
      'Event creation copies them to event registration cards',
    );
    expect(templateAddOnCopyNotice(2)).toContain(
      'standalone before-event and during-event add-on sales are not available yet',
    );
  });
});

describe('TemplateCreateEventComponent template', () => {
  it('renders explicit loading and error states while the source template is unavailable', () => {
    const template = templateCreateEventTemplate();

    expect(template).toContain('templateQuery.isPending()');
    expect(template).toContain('Loading template ...');
    expect(template).toContain('templateQuery.isError()');
    expect(template).toContain('Failed to load template.');
    expect(template).toContain('Create event from template');
  });
});
