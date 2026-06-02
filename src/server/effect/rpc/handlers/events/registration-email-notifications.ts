const greetingFor = (firstName: string | undefined) =>
  firstName?.trim() ? `Hi ${firstName.trim()},` : 'Hi,';

export const notificationEmailForUser = (user: {
  communicationEmail?: null | string | undefined;
  email: string;
}) => user.communicationEmail?.trim() || user.email;

export const buildRegistrationConfirmedEmailNotification = ({
  eventTitle,
  recipientFirstName,
  registrationId,
  tenantName,
}: {
  eventTitle: string;
  recipientFirstName?: string | undefined;
  registrationId: string;
  tenantName: string;
}) => ({
  payload: {
    eventTitle,
    registrationId,
  },
  subject: `Registration confirmed for ${eventTitle}`,
  textBody: [
    greetingFor(recipientFirstName),
    '',
    `${tenantName} has confirmed your registration for ${eventTitle}.`,
    '',
    'Open Evorto to view your ticket and event details.',
  ].join('\n'),
});

export const buildRegistrationCancelledEmailNotification = ({
  eventTitle,
  recipientFirstName,
  registrationId,
  tenantName,
}: {
  eventTitle: string;
  recipientFirstName?: string | undefined;
  registrationId: string;
  tenantName: string;
}) => ({
  payload: {
    eventTitle,
    registrationId,
  },
  subject: `Registration cancelled for ${eventTitle}`,
  textBody: [
    greetingFor(recipientFirstName),
    '',
    `Your registration for ${eventTitle} with ${tenantName} has been cancelled.`,
    '',
    'Open Evorto to review the event status.',
  ].join('\n'),
});

export const buildRegistrationTransferredEmailNotification = ({
  eventTitle,
  recipientFirstName,
  registrationId,
  tenantName,
}: {
  eventTitle: string;
  recipientFirstName: string;
  registrationId: string;
  tenantName: string;
}) => ({
  payload: {
    eventTitle,
    registrationId,
  },
  subject: `Registration transferred for ${eventTitle}`,
  textBody: [
    `Hi ${recipientFirstName},`,
    '',
    `${tenantName} has transferred a registration for ${eventTitle} to you.`,
    '',
    'Open Evorto to view the registration details.',
  ].join('\n'),
});

export const buildWaitlistSpotAvailableEmailNotification = ({
  eventTitle,
  recipientFirstName,
  registrationId,
  tenantName,
}: {
  eventTitle: string;
  recipientFirstName?: string | undefined;
  registrationId: string;
  tenantName: string;
}) => ({
  payload: {
    eventTitle,
    registrationId,
  },
  subject: `Spot available for ${eventTitle}`,
  textBody: [
    greetingFor(recipientFirstName),
    '',
    `A spot may be available for ${eventTitle} with ${tenantName}.`,
    '',
    'Open Evorto to review the event page and register if the spot is still available.',
  ].join('\n'),
});
