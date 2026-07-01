import { Config, Effect, Option } from 'effect';
import { htmlToText } from 'html-to-text';

import type { Tenant } from '../../types/custom/tenant';

import { optionalTrimmedString } from '../config/config-string';

const resendApiKeyConfig = optionalTrimmedString('RESEND_API_KEY');
const defaultSenderEmailConfig = optionalTrimmedString('RESEND_DEFAULT_FROM');

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
  tenant: Pick<Tenant, 'emailSenderEmail' | 'emailSenderName' | 'name'>;
  to: string;
}

interface TenantEmailSender {
  email: string;
  name: string;
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const formatSender = ({ email, name }: TenantEmailSender): string =>
  `${name.replaceAll('"', '').trim()} <${email}>`;

const resolveSender = (
  tenant: Pick<Tenant, 'emailSenderEmail' | 'emailSenderName' | 'name'>,
  fallbackEmail: Option.Option<string>,
): Option.Option<TenantEmailSender> => {
  const email = tenant.emailSenderEmail?.trim();
  const fallback = Option.getOrUndefined(fallbackEmail);
  const senderEmail = email || fallback;
  if (!senderEmail) {
    return Option.none();
  }

  return Option.some({
    email: senderEmail,
    name: tenant.emailSenderName?.trim() || tenant.name,
  });
};

const sendTenantEmail = ({
  html,
  idempotencyKey,
  subject,
  tenant,
  to,
}: SendTenantEmailInput): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const [apiKey, fallbackSenderEmail] = yield* Config.all([
      resendApiKeyConfig,
      defaultSenderEmailConfig,
    ]);
    if (Option.isNone(apiKey)) {
      return;
    }

    const sender = resolveSender(tenant, fallbackSenderEmail);
    if (Option.isNone(sender)) {
      return;
    }

    yield* Effect.tryPromise({
      catch: (cause) => cause,
      try: async () => {
        const response = await fetch('https://api.resend.com/emails', {
          body: JSON.stringify({
            from: formatSender(sender.value),
            html,
            subject,
            text: htmlToText(html, { wordwrap: 100 }),
            to,
          }),
          headers: {
            Authorization: `Bearer ${apiKey.value}`,
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
    tenant: input.tenant,
    to: input.to,
  }).pipe(Effect.catch(() => Effect.void));

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
    tenant: input.tenant,
    to: input.to,
  }).pipe(Effect.catch(() => Effect.void));
