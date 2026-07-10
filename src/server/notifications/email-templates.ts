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

export interface ManualApprovalEmailProps {
  readonly eventTitle: string;
  readonly eventUrl: string;
  readonly paymentDeadline: Date | null;
  readonly tenantName: string;
}

export interface ReceiptReviewedEmailProps {
  readonly eventTitle: string;
  readonly rejectionReason: null | string;
  readonly status: 'approved' | 'rejected';
  readonly tenantName: string;
}

export type RegistrationCancellationActor =
  'organizer' | 'participant' | 'platformAdministrator';

export interface RegistrationCancelledEmailProps {
  readonly cancelledBy: RegistrationCancellationActor;
  readonly eventTitle: string;
  readonly eventUrl: string;
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
          `This transactional message was sent by ${tenantName} through Evorto.`,
        ),
      ),
    ),
  );

const paragraph = (key: string, content: string): ReactElement =>
  createElement(Text, { key, style: paragraphStyle }, content);

export const ManualApprovalEmail = ({
  eventTitle,
  eventUrl,
  paymentDeadline,
  tenantName,
}: ManualApprovalEmailProps): ReactElement => {
  const paymentRequired = paymentDeadline !== null;
  return TransactionalEmailLayout({
    action: {
      href: eventUrl,
      label: paymentRequired
        ? 'Open event and complete payment'
        : 'Open your registration in Evorto',
    },
    body: [
      paragraph(
        'approved',
        `Your registration application for ${eventTitle} was approved.`,
      ),
      paragraph(
        'status',
        paymentDeadline
          ? `Your spot is reserved until ${paymentDeadline.toISOString()}. Complete payment before that deadline to confirm your registration.`
          : 'Your registration is confirmed.',
      ),
    ],
    preview: paymentRequired
      ? `Your application for ${eventTitle} was approved. Payment is required.`
      : `Your application for ${eventTitle} was approved and confirmed.`,
    tenantName,
    title: paymentRequired
      ? 'Registration approved: payment required'
      : 'Registration approved',
  });
};

ManualApprovalEmail.PreviewProps = {
  eventTitle: 'City tour',
  eventUrl: 'https://example.org/events/event-1',
  paymentDeadline: null,
  tenantName: 'Example Section',
} satisfies ManualApprovalEmailProps;

export const ReceiptReviewedEmail = ({
  eventTitle,
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
    paragraph('next-step', 'You can review the receipt status in Evorto.'),
  );

  return TransactionalEmailLayout({
    body,
    preview: `Your ${eventTitle} receipt was ${approved ? 'approved' : 'rejected'}.`,
    tenantName,
    title: approved ? 'Receipt approved' : 'Receipt rejected',
  });
};

ReceiptReviewedEmail.PreviewProps = {
  eventTitle: 'City tour',
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
      paragraph(
        'confirmed',
        `Your registration for ${eventTitle} is confirmed.`,
      ),
      paragraph(
        'ticket-access',
        'Sign in to Evorto to open your ticket. The ticket link is not a bearer credential and cannot be used without your authenticated account.',
      ),
    ],
    preview: `Your registration for ${eventTitle} is confirmed.`,
    tenantName,
    title: 'Registration confirmed',
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
      label: 'Review registration availability',
    },
    body: [
      paragraph('available', `A spot may now be available for ${eventTitle}.`),
      paragraph(
        'not-reserved',
        'This message is informational and does not reserve a spot. Open the event, leave the waitlist, and register if capacity is still available.',
      ),
    ],
    preview: `A spot may be available for ${eventTitle}; it is not reserved.`,
    tenantName,
    title: 'A waitlist spot may be available',
  });

WaitlistSpotAvailableEmail.PreviewProps = {
  eventTitle: 'City tour',
  eventUrl: 'https://example.org/events/event-1',
  tenantName: 'Example Section',
} satisfies WaitlistSpotAvailableEmailProps;

export const RegistrationCancelledEmail = ({
  cancelledBy,
  eventTitle,
  eventUrl,
  tenantName,
}: RegistrationCancelledEmailProps): ReactElement => {
  const cancellationCopy =
    cancelledBy === 'participant'
      ? {
          body: `You cancelled your registration for ${eventTitle}.`,
          preview: `Your registration for ${eventTitle} was cancelled.`,
        }
      : cancelledBy === 'platformAdministrator'
        ? {
            body: `A platform administrator cancelled your registration for ${eventTitle}.`,
            preview: `A platform administrator cancelled your registration for ${eventTitle}.`,
          }
        : {
            body: `An organizer cancelled your registration for ${eventTitle}.`,
            preview: `An organizer cancelled your registration for ${eventTitle}.`,
          };

  return TransactionalEmailLayout({
    action: {
      href: eventUrl,
      label: 'Review the event in Evorto',
    },
    body: [
      paragraph('cancelled', cancellationCopy.body),
      paragraph(
        'next-step',
        'Open the event to review its current registration options and status.',
      ),
    ],
    preview: cancellationCopy.preview,
    tenantName,
    title: 'Registration cancelled',
  });
};

RegistrationCancelledEmail.PreviewProps = {
  cancelledBy: 'participant',
  eventTitle: 'City tour',
  eventUrl: 'https://example.org/events/event-1',
  tenantName: 'Example Section',
} satisfies RegistrationCancelledEmailProps;

export const RegistrationTransferredEmail = ({
  eventTitle,
  eventUrl,
  recipientRole,
  tenantName,
}: RegistrationTransferredEmailProps): ReactElement => {
  const newOwner = recipientRole === 'newOwner';
  return TransactionalEmailLayout({
    action: {
      href: eventUrl,
      label: newOwner
        ? 'Open your transferred ticket in Evorto'
        : 'Review the event in Evorto',
    },
    body: [
      paragraph(
        'transfer',
        newOwner
          ? `The registration for ${eventTitle} was transferred to you.`
          : `Your registration for ${eventTitle} was transferred to another participant.`,
      ),
      paragraph(
        'access',
        newOwner
          ? 'Sign in to Evorto to review the registration and open its ticket.'
          : 'You no longer have access to this registration or its ticket.',
      ),
    ],
    preview: newOwner
      ? `The registration for ${eventTitle} was transferred to you.`
      : `Your registration for ${eventTitle} was transferred.`,
    tenantName,
    title: newOwner
      ? 'Registration transferred to you'
      : 'Registration transferred',
  });
};

RegistrationTransferredEmail.PreviewProps = {
  eventTitle: 'City tour',
  eventUrl: 'https://example.org/events/event-1',
  recipientRole: 'newOwner',
  tenantName: 'Example Section',
} satisfies RegistrationTransferredEmailProps;
