import {
  apply,
  applyEach,
  disabled,
  hidden,
  min,
  required,
  schema,
  validate,
} from '@angular/forms/signals';
import { hasTemporaryRichTextImageSources } from '@shared/utils/rich-text-media';

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

const richTextUploadError = (value: string) =>
  hasTemporaryRichTextImageSources(value)
    ? {
        kind: 'richTextPendingUpload',
        message: 'Wait for image uploads to finish before saving.',
      }
    : undefined;

export const eventGraphFormSchema = schema<EventGraphFormModel>((form) => {
  required(form.title, { message: 'Enter an event title.' });
  required(form.description, { message: 'Enter an event description.' });
  required(form.icon, { message: 'Choose an event icon.' });
  required(form.start, { message: 'Enter an event start.' });
  required(form.end, { message: 'Enter an event end.' });
  validate(form.description, ({ value }) => richTextUploadError(value()));
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
  hidden(form.addOns, ({ valueOf }) => valueOf(form.simpleModeEnabled));

  applyEach(form.registrationOptions, (option) => {
    required(option.title, { message: 'Enter an option name.' });
    required(option.openRegistrationTime, {
      message: 'Enter a registration opening time.',
    });
    required(option.closeRegistrationTime, {
      message: 'Enter a registration closing time.',
    });
    validate(option.description, ({ value }) => richTextUploadError(value()));
    validate(option.registeredDescription, ({ value }) =>
      richTextUploadError(value()),
    );
    validate(option.closeRegistrationTime, ({ value, valueOf }) => {
      const close = value();
      const open = valueOf(option.openRegistrationTime);
      if (!close || !open) return;
      return close.toMillis() < open.toMillis()
        ? {
            kind: 'registrationDateOrder',
            message: 'Registration must close after it opens.',
          }
        : undefined;
    });
    required(option.price, {
      message: 'Enter a price.',
      when: ({ valueOf }) => valueOf(option.isPaid),
    });
    min(option.price, 1, {
      message: 'Paid registrations must cost at least 0.01.',
    });
    validate(option.price, ({ value }) => nonNegativeIntegerError(value()));
    required(option.spots, { message: 'Enter a capacity.' });
    min(option.spots, 0, { message: 'Capacity cannot be negative.' });
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
            message: 'Discounted price cannot exceed the base price.',
          }
        : undefined;
    });
  });

  applyEach(form.questions, (question) => {
    required(question.title, { message: 'Enter a question.' });
    required(question.registrationOptionKey, {
      message: 'Choose the registration option that receives this question.',
    });
    required(question.sortOrder, { message: 'Enter a sort order.' });
    min(question.sortOrder, 0, { message: 'Sort order cannot be negative.' });
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
            message: 'Choose an option that still belongs to this event.',
          };
    });
  });

  applyEach(form.addOns, (addOn) => {
    required(addOn.title, { message: 'Enter an add-on name.' });
    validate(addOn.description, ({ value }) => richTextUploadError(value()));
    required(addOn.price, {
      message: 'Enter a price.',
      when: ({ valueOf }) => valueOf(addOn.isPaid),
    });
    min(addOn.price, 1, {
      message: 'Paid add-ons must cost at least 0.01.',
    });
    validate(addOn.price, ({ value }) => nonNegativeIntegerError(value()));
    required(addOn.maxQuantityPerUser, {
      message: 'Enter a per-user maximum.',
    });
    validate(addOn.maxQuantityPerUser, ({ value }) =>
      positiveIntegerError(value()),
    );
    required(addOn.totalAvailableQuantity, {
      message: 'Enter total stock.',
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
            message: 'Enable at least one purchase window.',
          };
    });
    validate(addOn.registrationOptions, ({ value }) => {
      const keys = value().map((mapping) => mapping.registrationOptionKey);
      return new Set(keys).size === keys.length
        ? undefined
        : {
            kind: 'duplicateRegistrationOption',
            message: 'Each registration option can be mapped only once.',
          };
    });
    applyEach(addOn.registrationOptions, (mapping) => {
      required(mapping.registrationOptionKey, {
        message: 'Choose a registration option.',
      });
      required(mapping.includedQuantity, {
        message: 'Enter an included quantity.',
      });
      required(mapping.optionalPurchaseQuantity, {
        message: 'Enter an optional quantity.',
      });
      validate(mapping.registrationOptionKey, ({ value, valueOf }) => {
        const optionKeys = new Set(
          valueOf(form.registrationOptions).map((option) => option.key),
        );
        return optionKeys.has(value())
          ? undefined
          : {
              kind: 'unknownRegistrationOption',
              message: 'Choose an option that still belongs to this event.',
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
            message: 'Include or offer at least one unit.',
          };
        }
        return included + optional > valueOf(addOn.totalAvailableQuantity)
          ? {
              kind: 'stockMaximum',
              message: 'Mapped quantity cannot exceed total stock.',
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
              message: 'Optional quantity cannot exceed the per-user maximum.',
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
