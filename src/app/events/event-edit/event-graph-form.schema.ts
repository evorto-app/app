import {
  apply,
  applyEach,
  disabled,
  hidden,
  max,
  maxLength,
  min,
  required,
  schema,
  validate,
} from '@angular/forms/signals';
import {
  MAX_EVENT_ADDON_TYPES,
  MAX_REGISTRATION_ADDON_QUANTITY,
} from '@shared/registration-quantity-limits';
import {
  MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
  MAX_REGISTRATION_QUESTION_TITLE_LENGTH,
  MAX_REGISTRATION_QUESTIONS,
} from '@shared/registration-question-limits';

import type { EventGraphFormModel } from './event-graph-form.model';

import { simpleEventGraphIssue } from './event-graph-form.model';

const nonNegativeIntegerError = (value: null | number) =>
  value !== null && (!Number.isInteger(value) || value < 0)
    ? {
        kind: 'nonNegativeInteger',
        message: 'Enter a whole number of zero or more.',
      }
    : undefined;

const positiveIntegerError = (value: number) =>
  !Number.isInteger(value) || value < 1
    ? {
        kind: 'positiveInteger',
        message: 'Enter a whole number of at least one.',
      }
    : undefined;

export const eventGraphFormSchema = schema<EventGraphFormModel>((form) => {
  required(form.title, { message: 'Enter an event title.' });
  required(form.description, { message: 'Enter an event description.' });
  required(form.icon, { message: 'Choose an event icon.' });
  required(form.start, { message: 'Enter an event start.' });
  required(form.end, { message: 'Enter an event end.' });
  validate(form.end, ({ value, valueOf }) => {
    const end = value();
    const start = valueOf(form.start);
    if (!end || !start) return;
    return end.toMillis() <= start.toMillis()
      ? {
          kind: 'dateOrder',
          message: 'The event must end after it starts.',
        }
      : undefined;
  });
  validate(form.registrationOptions, ({ value, valueOf }) => {
    const issue = valueOf(form.simpleModeEnabled)
      ? simpleEventGraphIssue(value())
      : null;
    return issue
      ? {
          kind: 'simpleModeCompatibility',
          message: issue,
        }
      : undefined;
  });
  validate(form.addOns, ({ value }) =>
    value().length > MAX_EVENT_ADDON_TYPES
      ? {
          kind: 'maxLength',
          message: `An event can have at most ${MAX_EVENT_ADDON_TYPES} add-ons.`,
        }
      : undefined,
  );
  validate(form.questions, ({ value }) =>
    value().length > MAX_REGISTRATION_QUESTIONS
      ? {
          kind: 'maxLength',
          message: `An event can have at most ${MAX_REGISTRATION_QUESTIONS} sign-up questions.`,
        }
      : undefined,
  );
  hidden(form.addOns, ({ valueOf }) => valueOf(form.simpleModeEnabled));

  applyEach(form.registrationOptions, (option) => {
    required(option.title, { message: 'Enter a sign-up choice name.' });
    required(option.openRegistrationTime, {
      message: 'Choose when sign-up opens.',
    });
    required(option.closeRegistrationTime, {
      message: 'Choose when sign-up closes.',
    });
    validate(option.closeRegistrationTime, ({ value, valueOf }) => {
      const close = value();
      const open = valueOf(option.openRegistrationTime);
      if (!close || !open) return;
      return close.toMillis() < open.toMillis()
        ? {
            kind: 'registrationDateOrder',
            message: 'Sign-up must close after it opens.',
          }
        : undefined;
    });
    required(option.price, {
      message: 'Enter a price.',
      when: ({ valueOf }) => valueOf(option.isPaid),
    });
    min(option.price, 1, {
      message: 'A paid choice must cost at least 0.01.',
    });
    validate(option.price, ({ value }) => nonNegativeIntegerError(value()));
    required(option.spots, { message: 'Enter the number of places.' });
    min(option.spots, 0, {
      message: 'The number of places cannot be negative.',
    });
    validate(option.spots, ({ value }) => nonNegativeIntegerError(value()));
    validate(option.cancellationDeadlineHoursBeforeStart, ({ value }) =>
      nonNegativeIntegerError(value()),
    );
    validate(option.transferDeadlineHoursBeforeStart, ({ value }) =>
      nonNegativeIntegerError(value()),
    );
    hidden(option.price, ({ valueOf }) => !valueOf(option.isPaid));
    hidden(
      option.esnCardDiscountedPrice,
      ({ valueOf }) => !valueOf(option.isPaid),
    );
    hidden(option.stripeTaxRateId, ({ valueOf }) => !valueOf(option.isPaid));
    required(option.stripeTaxRateId, { message: 'Choose a tax rate.' });
    validate(option.esnCardDiscountedPrice, ({ value, valueOf }) => {
      const discountedPrice = value();
      if (discountedPrice === '') return;
      if (!Number.isInteger(discountedPrice) || discountedPrice < 0) {
        return {
          kind: 'nonNegativeInteger',
          message: 'Discounted price must be a whole number of zero or more.',
        };
      }
      return discountedPrice > valueOf(option.price)
        ? {
            kind: 'discountMaximum',
            message: 'Discounted price cannot exceed the regular price.',
          }
        : undefined;
    });
  });

  applyEach(form.questions, (question) => {
    required(question.title, { message: 'Enter a question.' });
    maxLength(question.title, MAX_REGISTRATION_QUESTION_TITLE_LENGTH, {
      message: `Questions must be ${MAX_REGISTRATION_QUESTION_TITLE_LENGTH} characters or fewer.`,
    });
    maxLength(
      question.description,
      MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH,
      {
        message: `Question descriptions must be ${MAX_REGISTRATION_QUESTION_DESCRIPTION_LENGTH} characters or fewer.`,
      },
    );
    required(question.registrationOptionKey, {
      message: 'Choose where this question appears.',
    });
    required(question.sortOrder, { message: 'Enter a display order.' });
    min(question.sortOrder, 0, {
      message: 'Question order cannot be negative.',
    });
    validate(question.sortOrder, ({ value }) =>
      nonNegativeIntegerError(value()),
    );
    validate(question.registrationOptionKey, ({ value, valueOf }) => {
      const optionKeys = new Set(
        valueOf(form.registrationOptions).map((option) => option.key),
      );
      return optionKeys.has(value())
        ? undefined
        : {
            kind: 'unknownRegistrationOption',
            message:
              'Choose a sign-up choice that still belongs to this event.',
          };
    });
  });

  applyEach(form.addOns, (addOn) => {
    required(addOn.title, { message: 'Enter an add-on name.' });
    required(addOn.price, {
      message: 'Enter a price.',
      when: ({ valueOf }) => valueOf(addOn.isPaid),
    });
    min(addOn.price, 1, {
      message: 'Paid add-ons must cost at least 0.01.',
    });
    validate(addOn.price, ({ value }) => nonNegativeIntegerError(value()));
    required(addOn.maxQuantityPerUser, {
      message: 'Enter the maximum each person can buy.',
    });
    max(addOn.maxQuantityPerUser, MAX_REGISTRATION_ADDON_QUANTITY, {
      message: `Each person can buy at most ${MAX_REGISTRATION_ADDON_QUANTITY} items.`,
    });
    validate(addOn.maxQuantityPerUser, ({ value }) =>
      positiveIntegerError(value()),
    );
    required(addOn.totalAvailableQuantity, {
      message: 'Enter the total available.',
    });
    validate(addOn.totalAvailableQuantity, ({ value }) =>
      nonNegativeIntegerError(value()),
    );
    hidden(addOn.price, ({ valueOf }) => !valueOf(addOn.isPaid));
    hidden(addOn.stripeTaxRateId, ({ valueOf }) => !valueOf(addOn.isPaid));
    required(addOn.stripeTaxRateId, { message: 'Choose a tax rate.' });
    validate(addOn.title, ({ valueOf }) => {
      return valueOf(addOn.allowPurchaseBeforeEvent) ||
        valueOf(addOn.allowPurchaseDuringEvent) ||
        valueOf(addOn.allowPurchaseDuringRegistration)
        ? undefined
        : {
            kind: 'purchaseWindow',
            message: 'Choose at least one time when this add-on is available.',
          };
    });
    validate(addOn.registrationOptions, ({ value }) => {
      const keys = value().map((mapping) => mapping.registrationOptionKey);
      return new Set(keys).size === keys.length
        ? undefined
        : {
            kind: 'duplicateRegistrationOption',
            message: 'Add each sign-up choice only once.',
          };
    });
    applyEach(addOn.registrationOptions, (mapping) => {
      required(mapping.registrationOptionKey, {
        message: 'Choose a sign-up choice.',
      });
      required(mapping.includedQuantity, {
        message: 'Enter how many items are included.',
      });
      required(mapping.optionalPurchaseQuantity, {
        message: 'Enter how many items people can buy.',
      });
      validate(mapping.registrationOptionKey, ({ value, valueOf }) => {
        const optionKeys = new Set(
          valueOf(form.registrationOptions).map((option) => option.key),
        );
        return optionKeys.has(value())
          ? undefined
          : {
              kind: 'unknownRegistrationOption',
              message:
                'Choose a sign-up choice that still belongs to this event.',
            };
      });
      validate(mapping.includedQuantity, ({ value, valueOf }) => {
        const included = value();
        const optional = valueOf(mapping.optionalPurchaseQuantity);
        const integerError = nonNegativeIntegerError(included);
        if (integerError) return integerError;
        if (included + optional === 0) {
          return {
            kind: 'emptyMapping',
            message: 'Include or offer at least one item.',
          };
        }
        if (included + optional > MAX_REGISTRATION_ADDON_QUANTITY) {
          return {
            kind: 'registrationQuantityMaximum',
            message: `Included and optional items cannot exceed ${MAX_REGISTRATION_ADDON_QUANTITY} per sign-up.`,
          };
        }
        return included + optional > valueOf(addOn.totalAvailableQuantity)
          ? {
              kind: 'stockMaximum',
              message:
                'The amount offered with this choice cannot exceed the total available.',
            }
          : undefined;
      });
      validate(mapping.optionalPurchaseQuantity, ({ value, valueOf }) => {
        const optional = value();
        const integerError = nonNegativeIntegerError(optional);
        if (integerError) return integerError;
        return optional > valueOf(addOn.maxQuantityPerUser)
          ? {
              kind: 'userMaximum',
              message:
                'The number people can buy cannot exceed the per-person maximum.',
            }
          : undefined;
      });
    });
  });
});

export const eventGraphFormSchemaWithPaymentAvailability = (
  paymentAllowed: () => boolean,
) =>
  schema<EventGraphFormModel>((form) => {
    apply(form, eventGraphFormSchema);
    applyEach(form.registrationOptions, (option) => {
      disabled(option.isPaid, () => !paymentAllowed());
      disabled(option.price, () => !paymentAllowed());
      disabled(option.esnCardDiscountedPrice, () => !paymentAllowed());
      disabled(option.stripeTaxRateId, () => !paymentAllowed());
    });
    applyEach(form.addOns, (addOn) => {
      disabled(addOn.isPaid, () => !paymentAllowed());
      disabled(addOn.price, () => !paymentAllowed());
      disabled(addOn.stripeTaxRateId, () => !paymentAllowed());
    });
  });
