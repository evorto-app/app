import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import { createElement, type CSSProperties, type ReactElement } from 'react';

import {
  registrationCancellationCompletedLabel,
  type RegistrationCancellationKind,
} from '../../shared/registration-cancellation';

export type { RegistrationCancellationKind } from '../../shared/registration-cancellation';

export interface ManualApprovalEmailProps {
  readonly eventTitle: string;
  readonly eventUrl: string;
  readonly paymentDeadlineText: null | string;
  readonly tenantName: string;
}

export interface ReceiptReviewedEmailProps {
  readonly eventTitle: string;
  readonly receiptUrl: string;
  readonly rejectionReason: null | string;
  readonly status: 'approved' | 'rejected';
  readonly tenantName: string;
}

export type RegistrationCancellationActor =
  | 'eligibilityChangedAfterPayment'
  | 'organizer'
  | 'participant'
  | 'platformAdministrator';

export const registrationCancellationEmailTitle = (
  kind: RegistrationCancellationKind,
): string => registrationCancellationCompletedLabel(kind);

export interface RegistrationCancelledEmailProps {
  readonly cancellationKind: RegistrationCancellationKind;
  readonly cancelledBy: RegistrationCancellationActor;
  readonly eventTitle: string;
  readonly eventUrl: string;
  readonly refundOutcome: 'notStarted' | 'pending';
  readonly tenantName: string;
}

export interface RegistrationConfirmedEmailProps {
  readonly eventTitle: string;
  readonly tenantName: string;
  readonly ticketUrl: string;
}

export interface RegistrationTransferredEmailProps {
  readonly eventTitle: string;
  readonly eventUrl: string;
  readonly recipientRole: 'newOwner' | 'previousOwner';
  readonly refundOutcome: 'notStarted' | 'pending';
  readonly tenantName: string;
}

export interface WaitlistSpotAvailableEmailProps {
  readonly eventTitle: string;
  readonly eventUrl: string;
  readonly tenantName: string;
}

interface EmailAction {
  readonly href: string;
  readonly label: string;
}

interface TransactionalEmailLayoutInput {
  readonly action?: EmailAction;
  readonly body: readonly ReactElement[];
  readonly preview: string;
  readonly tenantName: string;
  readonly title: string;
}

const bodyStyle = {
  backgroundColor: '#f4f4f5',
  color: '#1c1b1f',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  margin: '0',
  padding: '32px 12px',
} satisfies CSSProperties;

const buttonStyle = {
  backgroundColor: '#00677d',
  borderRadius: '8px',
  boxSizing: 'border-box',
  color: '#ffffff',
  display: 'inline-block',
  fontSize: '16px',
  fontWeight: '600',
  lineHeight: '20px',
  minHeight: '44px',
  padding: '12px 20px',
  textAlign: 'center',
  textDecoration: 'none',
} satisfies CSSProperties;

const containerStyle = {
  backgroundColor: '#ffffff',
  borderRadius: '12px',
  margin: '0 auto',
  maxWidth: '600px',
  padding: '28px',
} satisfies CSSProperties;

const footerStyle = {
  color: '#5f5f66',
  fontSize: '13px',
  lineHeight: '20px',
  margin: '0',
} satisfies CSSProperties;

const headingStyle = {
  color: '#1c1b1f',
  fontSize: '24px',
  fontWeight: '700',
  lineHeight: '32px',
  margin: '0 0 20px',
} satisfies CSSProperties;

const horizontalRuleStyle = {
  borderColor: '#c7c5ca',
  borderStyle: 'solid',
  borderWidth: '1px 0 0',
  margin: '28px 0 20px',
} satisfies CSSProperties;

const paragraphStyle = {
  color: '#1c1b1f',
  fontSize: '16px',
  lineHeight: '24px',
  margin: '0 0 16px',
} satisfies CSSProperties;

const TransactionalEmailLayout = ({
  action,
  body,
  preview,
  tenantName,
  title,
}: TransactionalEmailLayoutInput): ReactElement =>
  createElement(
    Html,
    { dir: 'ltr', lang: 'en' },
    createElement(Head, null, createElement('title', null, title)),
    createElement(
      Body,
      { style: bodyStyle },
      createElement(Preview, { children: preview, dir: 'ltr', lang: 'en' }),
      createElement(
        Container,
        { dir: 'ltr', lang: 'en', style: containerStyle },
        createElement(Heading, { as: 'h1', style: headingStyle }, title),
        createElement(Section, null, ...body),
        action
          ? createElement(
              Button,
              {
                href: action.href,
                style: buttonStyle,
              },
              action.label,
            )
          : null,
        createElement(Hr, { style: horizontalRuleStyle }),
        createElement(
          Text,
          { style: footerStyle },
          `This email was sent by ${tenantName} through Evorto.`,
        ),
      ),
    ),
  );

const paragraph = (key: string, content: string): ReactElement =>
  createElement(Text, { key, style: paragraphStyle }, content);

export const ManualApprovalEmail = ({
  eventTitle,
  eventUrl,
  paymentDeadlineText,
  tenantName,
}: ManualApprovalEmailProps): ReactElement => {
  const paymentRequired = paymentDeadlineText !== null;
  return TransactionalEmailLayout({
    action: {
      href: eventUrl,
      label: paymentRequired
        ? 'Open event and complete payment'
        : 'Open your ticket in Evorto',
    },
    body: [
      paragraph('approved', `Your sign-up for ${eventTitle} was approved.`),
      paragraph(
        'status',
        paymentDeadlineText
          ? `Your place is reserved until ${paymentDeadlineText}. Complete payment before that deadline to finish your sign-up.`
          : 'Your ticket is confirmed.',
      ),
    ],
    preview: paymentRequired
      ? `Your sign-up for ${eventTitle} was approved. Payment is required.`
      : `Your ticket for ${eventTitle} is confirmed.`,
    tenantName,
    title: paymentRequired
      ? 'Sign-up approved: payment required'
      : 'Sign-up approved',
  });
};

ManualApprovalEmail.PreviewProps = {
  eventTitle: 'City tour',
  eventUrl: 'https://example.org/events/event-1',
  paymentDeadlineText: null,
  tenantName: 'Example Section',
} satisfies ManualApprovalEmailProps;

export const ReceiptReviewedEmail = ({
  eventTitle,
  receiptUrl,
  rejectionReason,
  status,
  tenantName,
}: ReceiptReviewedEmailProps): ReactElement => {
  const approved = status === 'approved';
  const body = [
    paragraph(
      'status',
      `Your receipt for ${eventTitle} was ${approved ? 'approved' : 'rejected'}.`,
    ),
  ];
  if (rejectionReason?.trim()) {
    body.push(paragraph('reason', `Reason: ${rejectionReason.trim()}`));
  }
  body.push(
    paragraph(
      'next-step',
      'Open Profile → Receipts to see the review and any reason provided.',
    ),
  );

  return TransactionalEmailLayout({
    action: {
      href: receiptUrl,
      label: 'Open your receipt in Evorto',
    },
    body,
    preview: `Your ${eventTitle} receipt was ${approved ? 'approved' : 'rejected'}.`,
    tenantName,
    title: approved ? 'Receipt approved' : 'Receipt rejected',
  });
};

ReceiptReviewedEmail.PreviewProps = {
  eventTitle: 'City tour',
  receiptUrl: 'https://example.org/profile/receipts',
  rejectionReason: null,
  status: 'approved',
  tenantName: 'Example Section',
} satisfies ReceiptReviewedEmailProps;

export const RegistrationConfirmedEmail = ({
  eventTitle,
  tenantName,
  ticketUrl,
}: RegistrationConfirmedEmailProps): ReactElement =>
  TransactionalEmailLayout({
    action: {
      href: ticketUrl,
      label: 'Open your ticket in Evorto',
    },
    body: [
      paragraph('confirmed', `Your ticket for ${eventTitle} is confirmed.`),
      paragraph(
        'ticket-access',
        'Sign in with the account that holds this ticket to open it.',
      ),
    ],
    preview: `Your ticket for ${eventTitle} is confirmed.`,
    tenantName,
    title: 'Ticket confirmed',
  });

RegistrationConfirmedEmail.PreviewProps = {
  eventTitle: 'City tour',
  tenantName: 'Example Section',
  ticketUrl: 'https://example.org/events/event-1',
} satisfies RegistrationConfirmedEmailProps;

export const WaitlistSpotAvailableEmail = ({
  eventTitle,
  eventUrl,
  tenantName,
}: WaitlistSpotAvailableEmailProps): ReactElement =>
  TransactionalEmailLayout({
    action: {
      href: eventUrl,
      label: 'Check for an available place',
    },
    body: [
      paragraph('available', `A place may now be available for ${eventTitle}.`),
      paragraph(
        'not-reserved',
        'We have not held a place for you. Open the event, leave the waitlist, and sign up while a place is still available.',
      ),
    ],
    preview: `A place may be available for ${eventTitle}; it is not reserved.`,
    tenantName,
    title: 'A place may be available',
  });

WaitlistSpotAvailableEmail.PreviewProps = {
  eventTitle: 'City tour',
  eventUrl: 'https://example.org/events/event-1',
  tenantName: 'Example Section',
} satisfies WaitlistSpotAvailableEmailProps;

export const RegistrationCancelledEmail = ({
  cancellationKind,
  cancelledBy,
  eventTitle,
  eventUrl,
  refundOutcome,
  tenantName,
}: RegistrationCancelledEmailProps): ReactElement => {
  const title = registrationCancellationEmailTitle(cancellationKind);
  const refundCopy =
    refundOutcome === 'pending'
      ? 'A refund to your original payment method is in progress. Open Profile → Events to follow it.'
      : cancellationKind === 'application' || cancellationKind === 'waitlist'
        ? 'No refund was needed.'
        : 'No refund was started for this cancellation.';
  const cancellationCopy = (() => {
    if (cancelledBy === 'eligibilityChangedAfterPayment') {
      return {
        body: `Your sign-up for ${eventTitle} could not be completed because the event or your access to it changed after you paid.`,
        nextStep: `${refundCopy} Do not try to pay again. If you still want to attend, check the event or contact the organizer.`,
        preview: `Your sign-up for ${eventTitle} was cancelled.`,
      };
    }

    const actor =
      cancelledBy === 'participant'
        ? 'You'
        : cancelledBy === 'organizer'
          ? 'An organizer'
          : 'Evorto';
    const body = (() => {
      switch (cancellationKind) {
        case 'application': {
          return cancelledBy === 'participant'
            ? `You withdrew your application for ${eventTitle}.`
            : `${actor} withdrew your application for ${eventTitle}.`;
        }
        case 'pendingSignUp': {
          return `${actor} cancelled your pending sign-up for ${eventTitle}.`;
        }
        case 'ticket': {
          return `${actor} cancelled your ticket for ${eventTitle}.`;
        }
        case 'waitlist': {
          return cancelledBy === 'participant'
            ? `You left the waitlist for ${eventTitle}.`
            : `${actor} removed you from the waitlist for ${eventTitle}.`;
        }
      }
    })();
    return {
      body,
      nextStep: `${refundCopy} Open the event to see the latest details.`,
      preview: body,
    };
  })();

  return TransactionalEmailLayout({
    action: {
      href: eventUrl,
      label: 'Open the event in Evorto',
    },
    body: [
      paragraph('cancelled', cancellationCopy.body),
      paragraph('next-step', cancellationCopy.nextStep),
    ],
    preview: cancellationCopy.preview,
    tenantName,
    title,
  });
};

RegistrationCancelledEmail.PreviewProps = {
  cancellationKind: 'ticket',
  cancelledBy: 'participant',
  eventTitle: 'City tour',
  eventUrl: 'https://example.org/events/event-1',
  refundOutcome: 'notStarted',
  tenantName: 'Example Section',
} satisfies RegistrationCancelledEmailProps;

export const RegistrationTransferredEmail = ({
  eventTitle,
  eventUrl,
  recipientRole,
  refundOutcome,
  tenantName,
}: RegistrationTransferredEmailProps): ReactElement => {
  const newOwner = recipientRole === 'newOwner';
  return TransactionalEmailLayout({
    action: {
      href: eventUrl,
      label: newOwner
        ? 'Open your transferred ticket in Evorto'
        : 'Open the event in Evorto',
    },
    body: [
      paragraph(
        'transfer',
        newOwner
          ? `The ticket for ${eventTitle} was transferred to you.`
          : `Your ticket for ${eventTitle} was transferred to another person.`,
      ),
      paragraph(
        'access',
        newOwner
          ? 'Sign in to Evorto to review and open the ticket.'
          : 'You no longer have access to this ticket.',
      ),
      ...(newOwner
        ? []
        : [
            paragraph(
              'refund',
              refundOutcome === 'pending'
                ? 'A refund to your original payment method is in progress.'
                : 'No refund was started for this transfer.',
            ),
          ]),
    ],
    preview: newOwner
      ? `The ticket for ${eventTitle} was transferred to you.`
      : `Your ticket for ${eventTitle} was transferred.`,
    tenantName,
    title: newOwner ? 'Ticket transferred to you' : 'Ticket transferred',
  });
};

RegistrationTransferredEmail.PreviewProps = {
  eventTitle: 'City tour',
  eventUrl: 'https://example.org/events/event-1',
  recipientRole: 'newOwner',
  refundOutcome: 'notStarted',
  tenantName: 'Example Section',
} satisfies RegistrationTransferredEmailProps;
