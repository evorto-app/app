import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

import { eventEditSubmitDisabled } from './event-edit';

const eventEditTemplate = (): string =>
  readFileSync(
    nodePath.join(process.cwd(), 'src/app/events/event-edit/event-edit.html'),
    'utf8',
  );

describe('eventEditSubmitDisabled', () => {
  it('blocks event edit submits while invalid, submitting, or awaiting the mutation', () => {
    expect(
      eventEditSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(false);
    expect(
      eventEditSubmitDisabled({
        formInvalid: true,
        formSubmitting: false,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      eventEditSubmitDisabled({
        formInvalid: false,
        formSubmitting: true,
        mutationPending: false,
      }),
    ).toBe(true);
    expect(
      eventEditSubmitDisabled({
        formInvalid: false,
        formSubmitting: false,
        mutationPending: true,
      }),
    ).toBe(true);
  });
});

describe('EventEdit template', () => {
  it('renders the edit form only after the source event loads', () => {
    const template = eventEditTemplate();

    expect(template).toContain('eventQuery.isPending()');
    expect(template).toContain('Loading event ...');
    expect(template).toContain('eventQuery.isError()');
    expect(template).toContain('Failed to load event.');
    expect(template).toContain('eventQuery.isSuccess()');
    expect(template).toContain('Edit event');
  });
});
