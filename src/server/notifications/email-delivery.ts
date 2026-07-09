import { Effect } from 'effect';
import { htmlToText } from 'html-to-text';

import type { Tenant } from '../../types/custom/tenant';

import { serverEmailConfig } from '../config/server-config';

export interface SendManualApprovalEmailInput {
  eventTitle: string;
  eventUrl: string;
  paymentDeadline: Date | null;
  registrationId: string;
  tenant: Pick<Tenant, 'emailSenderEmail' | 'emailSenderName' | 'id' | 'name'>;
  to: string;
}

export interface SendReceiptReviewedEmailInput {
  eventTitle: string;
  receiptId: string;
  rejectionReason: null | string;
  status: 'approved' | 'rejected';
  tenant: Pick<Tenant, 'emailSenderEmail' | 'emailSenderName' | 'id' | 'name'>;
  to: string;
}

interface SendTenantEmailInput {
  html: string;
  idempotencyKey: string;
  subject: string;
  to: string;
}

interface TenantEmailSender {
  email: string;
  name: string;
}

const defaultEmailSender = {
  email: 'no-reply@notifications.esn.world',
  name: 'ESN.WORLD',
} satisfies TenantEmailSender;

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const formatSender = ({ email, name }: TenantEmailSender): string =>
  `${name.replaceAll('"', '').trim()} <${email}>`;

const sendTenantEmail = ({
  html,
  idempotencyKey,
  subject,
  to,
}: SendTenantEmailInput): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const emailConfig = yield* serverEmailConfig;

    yield* Effect.tryPromise({
      catch: (cause) => cause,
      try: async () => {
        const response = await fetch('https://api.resend.com/emails', {
          body: JSON.stringify({
            from: formatSender(defaultEmailSender),
            html,
            subject,
            text: htmlToText(html, { wordwrap: 100 }),
            to,
          }),
          headers: {
            Authorization: `Bearer ${emailConfig.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          method: 'POST',
        });

        if (!response.ok) {
          throw new Error(`Resend email request failed: ${response.status}`);
        }
      },
    });
  });

const renderReceiptReviewedEmail = ({
  eventTitle,
  rejectionReason,
  status,
}: Pick<
  SendReceiptReviewedEmailInput,
  'eventTitle' | 'rejectionReason' | 'status'
>): string => {
  const statusLabel = status === 'approved' ? 'approved' : 'rejected';
  const safeEventTitle = escapeHtml(eventTitle);
  const safeReason = rejectionReason?.trim()
    ? `<p><strong>Reason:</strong> ${escapeHtml(rejectionReason.trim())}</p>`
    : '';

  return `<!doctype html>
<html>
  <body>
    <p>Your receipt for <strong>${safeEventTitle}</strong> was ${statusLabel}.</p>
    ${safeReason}
    <p>You can review the receipt status in Evorto.</p>
  </body>
</html>`;
};

export const sendReceiptReviewedEmail = (
  input: SendReceiptReviewedEmailInput,
): Effect.Effect<void> =>
  sendTenantEmail({
    html: renderReceiptReviewedEmail(input),
    idempotencyKey: `receipt-reviewed:${input.tenant.id}:${input.receiptId}:${input.status}`,
    subject:
      input.status === 'approved' ? 'Receipt approved' : 'Receipt rejected',
    to: input.to,
  }).pipe(Effect.orDie);

const renderManualApprovalEmail = ({
  eventTitle,
  eventUrl,
  paymentDeadline,
}: Pick<
  SendManualApprovalEmailInput,
  'eventTitle' | 'eventUrl' | 'paymentDeadline'
>): string => {
  const safeEventTitle = escapeHtml(eventTitle);
  const safeEventUrl = escapeHtml(eventUrl);
  const paymentCopy = paymentDeadline
    ? `<p>Your spot is reserved until ${escapeHtml(paymentDeadline.toISOString())}. Complete payment before that deadline to confirm your registration.</p>`
    : '<p>Your registration is confirmed.</p>';

  return `<!doctype html>
<html>
  <body>
    <p>Your registration application for <strong>${safeEventTitle}</strong> was approved.</p>
    ${paymentCopy}
    <p><a href="${safeEventUrl}">Open the event in Evorto</a></p>
  </body>
</html>`;
};

export const sendManualApprovalEmail = (
  input: SendManualApprovalEmailInput,
): Effect.Effect<void> =>
  sendTenantEmail({
    html: renderManualApprovalEmail(input),
    idempotencyKey: `manual-approval:${input.tenant.id}:${input.registrationId}:${input.paymentDeadline?.toISOString() ?? 'confirmed'}`,
    subject: input.paymentDeadline
      ? 'Registration approved: payment required'
      : 'Registration approved',
    to: input.to,
  }).pipe(Effect.orDie);
