import { describe, expect, it, vi } from '@effect/vitest';
import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { resolveFinanceReimbursementBatch } from '@shared/finance/reimbursement';
import {
  PlatformFinanceCheckoutRecoveryQueueInput,
  PlatformFinanceReceiptApprovalDetail,
  PlatformFinanceReceiptApprovalDetailRecord,
  PlatformFinanceReceiptApprovalGroup,
  PlatformFinanceReceiptApprovalQueue,
  PlatformFinanceReceiptReview,
  PlatformFinanceReceiptWithSubmitterRecord,
  PlatformFinanceRecoverCheckoutInput,
  PlatformFinanceRefundRecoveryQueue,
  PlatformFinanceReimbursementGroup,
  PlatformFinanceReimbursementQueue,
  PlatformFinanceReimbursementReceipt,
  PlatformFinanceTenantContext,
  PlatformFinanceTransactionsFindMany,
} from '@shared/rpc-contracts/app-rpcs/platform-tenant-finance.rpcs';
import {
  RpcRequestContext,
  RpcRequestContextMiddleware,
} from '@shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';
import { type GetColumnData } from 'drizzle-orm';
import { Cause, type Context, Effect, Exit, Layer, Schema } from 'effect';
import * as Headers from 'effect/unstable/http/Headers';
import { Rpc, RpcMessage } from 'effect/unstable/rpc';
import { readFileSync } from 'node:fs';

import { eventInstances, tenants, users } from '../../../../../db/schema';
import { PlatformAdministratorAuthority } from '../../../../../types/custom/platform-authority';
import { Tenant } from '../../../../../types/custom/tenant';
import { RegistrationRefundRequeueError } from '../../../../payments/registration-refund';
import { createRegistrationDatabaseTestLayer } from '../../../../testing/registration-database';
import {
  stripeCheckoutSessionResponse,
  stripeLineItemFixture,
  stripeTaxRateFixture,
} from '../../../../testing/stripe-test-fixtures';
import { ReceiptMediaServiceUnavailableError } from '../finance/finance.errors';
import { type financeReceiptView } from '../finance/finance.shared';
import { ReceiptMediaService } from '../finance/receipt-media.service';
import { RpcAccess } from '../shared/rpc-access.service';
import {
  checkoutRecoveryVersion,
  recoveryLineItemsOwnClaim,
  recoverySessionOwnsClaim,
} from './platform-checkout-recovery';
import {
  canPlatformReviewReceipt,
  mapPlatformRefundRequeueError,
  payoutDetailsVersion,
  platformReceiptReviewUpdate,
  platformReimbursementReceiptUpdate,
  platformReimbursementTransactionInsert,
  platformTenantFinanceHandlers,
  refundRecoveryAuditSnapshot,
  reimbursementAuditSnapshot,
  toPlatformFinanceTransactionRecord,
  toRefundRecoveryRecord,
} from './platform-tenant-finance.handlers';

const receiptWithSubmitterInput = (
  status: 'approved' | 'submitted',
): Parameters<typeof PlatformFinanceReceiptWithSubmitterRecord.make>[0] => ({
  alcoholAmount: 0,
  attachmentFileName: 'receipt.pdf',
  attachmentMimeType: 'application/pdf',
  createdAt: '2026-07-10T10:00:00.000Z',
  currency: 'EUR',
  depositAmount: 0,
  eventId: 'event-1',
  hasAlcohol: false,
  hasDeposit: false,
  id: 'receipt-1',
  purchaseCountry: 'DE',
  receiptDate: '2026-07-09',
  refundedAt: null,
  refundTransactionId: null,
  rejectionReason: null,
  reviewedAt: null,
  status,
  submittedByEmail: 'participant@example.test',
  submittedByFirstName: 'Pat',
  submittedByLastName: 'Example',
  submittedByUserId: 'user-1',
  taxAmount: 190,
  totalAmount: 1190,
  updatedAt: '2026-07-10T10:00:00.000Z',
});

const tenantContext = () =>
  PlatformFinanceTenantContext.make({
    currency: 'EUR',
    receiptCountryConfig: { allowOther: false, receiptCountries: ['DE'] },
    targetTenantId: 'tenant-1',
    timezone: 'Australia/Brisbane',
  });

const platformAuthority = PlatformAdministratorAuthority.make({
  actorEmail: 'platform@example.org',
  actorId: 'auth0|platform-admin',
  kind: 'platformAdministrator',
});

const targetTenant = Tenant.make({
  cancellationDeadlineHoursBeforeStart: 120,
  currency: 'EUR',
  defaultLocation: undefined,
  discountProviders: { esnCard: { config: {}, status: 'disabled' } },
  domain: 'target.example.org',
  emailSenderEmail: undefined,
  emailSenderName: undefined,
  faviconUrl: undefined,
  id: 'tenant-1',
  legalNoticeText: undefined,
  legalNoticeUrl: undefined,
  logoUrl: undefined,
  maxActiveRegistrationsPerUser: 0,
  name: 'Target tenant',
  privacyPolicyText: undefined,
  privacyPolicyUrl: undefined,
  receiptSettings: { allowOther: false, receiptCountries: ['DE'] },
  refundFeesOnCancellation: true,
  seoDescription: undefined,
  seoTitle: undefined,
  stripeAccountId: undefined,
  termsText: undefined,
  termsUrl: undefined,
  theme: 'evorto',
  timezone: 'Europe/Berlin',
  transferDeadlineHoursBeforeStart: 0,
});

type ReceiptEvidenceRow = {
  [Key in keyof typeof financeReceiptView]: GetColumnData<
    (typeof financeReceiptView)[Key]
  >;
};

const submittedReceiptEvidence = {
  alcoholAmount: 0,
  attachmentFileName: 'receipt.pdf',
  attachmentMimeType: 'application/pdf',
  attachmentStorageKey: 'receipts/tenant-1/event-1/user-1/upload-1-receipt.pdf',
  attachmentUploadConsumedAt: new Date('2026-07-10T08:00:00.000Z'),
  attachmentUploadedAt: new Date('2026-07-10T07:59:00.000Z'),
  attachmentUploadedByUserId: 'user-1',
  attachmentUploadEventId: 'event-1',
  attachmentUploadId: 'upload-1',
  attachmentUploadStatus: 'consumed',
  attachmentUploadTenantId: 'tenant-1',
  createdAt: new Date('2026-07-10T08:00:00.000Z'),
  currency: 'EUR' as const,
  depositAmount: 0,
  eventId: 'event-1',
  hasAlcohol: false,
  hasDeposit: false,
  id: 'receipt-1',
  purchaseCountry: 'DE',
  receiptDate: '2026-07-09',
  refundedAt: null,
  refundTransactionId: null,
  rejectionReason: null,
  reviewedAt: null,
  status: 'submitted' as const,
  submittedByUserId: 'user-1',
  taxAmount: 190,
  tenantId: 'tenant-1',
  totalAmount: 1190,
  updatedAt: new Date('2026-07-10T08:00:00.000Z'),
} satisfies ReceiptEvidenceRow;

const platformTargetTenantSql =
  'select "d0"."cancellation_deadline_hours_before_start" as "cancellationDeadlineHoursBeforeStart", "d0"."createdAt"::text as "createdAt", "d0"."currency" as "currency", "d0"."default_location" as "defaultLocation", "d0"."discount_providers" as "discountProviders", "d0"."domain" as "domain", "d0"."email_sender_email" as "emailSenderEmail", "d0"."email_sender_name" as "emailSenderName", "d0"."favicon_url" as "faviconUrl", "d0"."id" as "id", "d0"."legal_notice_text" as "legalNoticeText", "d0"."legal_notice_url" as "legalNoticeUrl", "d0"."logo_url" as "logoUrl", "d0"."max_active_registrations_per_user" as "maxActiveRegistrationsPerUser", "d0"."name" as "name", "d0"."receipt_settings" as "receiptSettings", "d0"."refund_fees_on_cancellation" as "refundFeesOnCancellation", "d0"."seoDescription" as "seoDescription", "d0"."seoTitle" as "seoTitle", "d0"."stripeAccountId" as "stripeAccountId", "d0"."terms_text" as "termsText", "d0"."terms_url" as "termsUrl", "d0"."theme" as "theme", "d0"."timezone" as "timezone", "d0"."transfer_deadline_hours_before_start" as "transferDeadlineHoursBeforeStart", "d0"."updatedAt"::text as "updatedAt" from "tenants" as "d0" where "d0"."id" = $1 limit $2';
const receiptApprovalEvidenceSql =
  'select "finance_receipts"."alcoholAmount", "finance_receipts"."attachmentFileName", "finance_receipt_uploads"."mimeType", "finance_receipt_uploads"."storageKey", "finance_receipt_uploads"."consumedAt"::text, "finance_receipt_uploads"."uploadedAt"::text, "finance_receipt_uploads"."uploadedByUserId", "finance_receipt_uploads"."eventId", "finance_receipt_uploads"."id", "finance_receipt_uploads"."status", "finance_receipt_uploads"."tenantId", "finance_receipts"."createdAt"::text, "finance_receipts"."currency", "finance_receipts"."depositAmount", "finance_receipts"."eventId", "finance_receipts"."hasAlcohol", "finance_receipts"."hasDeposit", "finance_receipts"."id", "finance_receipts"."purchaseCountry", "finance_receipts"."receiptDate"::text, "finance_receipts"."refundedAt"::text, "finance_receipts"."refundTransactionId", "finance_receipts"."rejectionReason", "finance_receipts"."reviewedAt"::text, "finance_receipts"."status", "finance_receipts"."submittedByUserId", "finance_receipts"."taxAmount", "finance_receipts"."tenantId", "finance_receipts"."totalAmount", "finance_receipts"."updatedAt"::text from "finance_receipts" inner join "finance_receipt_uploads" on (("finance_receipts"."attachmentUploadId" = "finance_receipt_uploads"."id") and ("finance_receipts"."tenantId" = "finance_receipt_uploads"."tenantId") and ("finance_receipts"."eventId" = "finance_receipt_uploads"."eventId") and ("finance_receipts"."submittedByUserId" = "finance_receipt_uploads"."uploadedByUserId")) where (("finance_receipts"."id" = $1) and ("finance_receipts"."tenantId" = $2)) limit $3';

const receiptApprovalDetailSql =
  'select "finance_receipts"."alcoholAmount", "finance_receipts"."attachmentFileName", "finance_receipt_uploads"."mimeType", "finance_receipt_uploads"."storageKey", "finance_receipt_uploads"."consumedAt"::text, "finance_receipt_uploads"."uploadedAt"::text, "finance_receipt_uploads"."uploadedByUserId", "finance_receipt_uploads"."eventId", "finance_receipt_uploads"."id", "finance_receipt_uploads"."status", "finance_receipt_uploads"."tenantId", "finance_receipts"."createdAt"::text, "finance_receipts"."currency", "finance_receipts"."depositAmount", "finance_receipts"."eventId", "finance_receipts"."hasAlcohol", "finance_receipts"."hasDeposit", "finance_receipts"."id", "finance_receipts"."purchaseCountry", "finance_receipts"."receiptDate"::text, "finance_receipts"."refundedAt"::text, "finance_receipts"."refundTransactionId", "finance_receipts"."rejectionReason", "finance_receipts"."reviewedAt"::text, "finance_receipts"."status", "finance_receipts"."submittedByUserId", "finance_receipts"."taxAmount", "finance_receipts"."tenantId", "finance_receipts"."totalAmount", "finance_receipts"."updatedAt"::text, "event_instances"."start"::text, "event_instances"."title", "users"."communicationEmail", "users"."email", "users"."firstName", "users"."lastName" from "finance_receipts" inner join "finance_receipt_uploads" on (("finance_receipts"."attachmentUploadId" = "finance_receipt_uploads"."id") and ("finance_receipts"."tenantId" = "finance_receipt_uploads"."tenantId") and ("finance_receipts"."eventId" = "finance_receipt_uploads"."eventId") and ("finance_receipts"."submittedByUserId" = "finance_receipt_uploads"."uploadedByUserId")) inner join "event_instances" on (("event_instances"."id" = "finance_receipts"."eventId") and ("event_instances"."tenantId" = $1)) inner join "users" on "users"."id" = "finance_receipts"."submittedByUserId" where (("finance_receipts"."id" = $2) and ("finance_receipts"."tenantId" = $3)) limit $4';
const receiptApprovalQueueSql =
  'select "finance_receipts"."alcoholAmount", "finance_receipts"."attachmentFileName", "finance_receipt_uploads"."mimeType", "finance_receipt_uploads"."storageKey", "finance_receipt_uploads"."consumedAt"::text, "finance_receipt_uploads"."uploadedAt"::text, "finance_receipt_uploads"."uploadedByUserId", "finance_receipt_uploads"."eventId", "finance_receipt_uploads"."id", "finance_receipt_uploads"."status", "finance_receipt_uploads"."tenantId", "finance_receipts"."createdAt"::text, "finance_receipts"."currency", "finance_receipts"."depositAmount", "finance_receipts"."eventId", "finance_receipts"."hasAlcohol", "finance_receipts"."hasDeposit", "finance_receipts"."id", "finance_receipts"."purchaseCountry", "finance_receipts"."receiptDate"::text, "finance_receipts"."refundedAt"::text, "finance_receipts"."refundTransactionId", "finance_receipts"."rejectionReason", "finance_receipts"."reviewedAt"::text, "finance_receipts"."status", "finance_receipts"."submittedByUserId", "finance_receipts"."taxAmount", "finance_receipts"."tenantId", "finance_receipts"."totalAmount", "finance_receipts"."updatedAt"::text, "event_instances"."start"::text, "event_instances"."title", "users"."communicationEmail", "users"."email", "users"."firstName", "users"."lastName" from "finance_receipts" inner join "finance_receipt_uploads" on (("finance_receipts"."attachmentUploadId" = "finance_receipt_uploads"."id") and ("finance_receipts"."tenantId" = "finance_receipt_uploads"."tenantId") and ("finance_receipts"."eventId" = "finance_receipt_uploads"."eventId") and ("finance_receipts"."submittedByUserId" = "finance_receipt_uploads"."uploadedByUserId")) inner join "event_instances" on (("event_instances"."id" = "finance_receipts"."eventId") and ("event_instances"."tenantId" = $1)) inner join "users" on "users"."id" = "finance_receipts"."submittedByUserId" where (("finance_receipts"."tenantId" = $2) and ("finance_receipts"."status" = $3)) order by "event_instances"."start" desc, "finance_receipts"."createdAt" desc';
const receiptReimbursementQueueSql =
  'select "finance_receipts"."alcoholAmount", "finance_receipts"."attachmentFileName", "finance_receipt_uploads"."mimeType", "finance_receipt_uploads"."storageKey", "finance_receipt_uploads"."consumedAt"::text, "finance_receipt_uploads"."uploadedAt"::text, "finance_receipt_uploads"."uploadedByUserId", "finance_receipt_uploads"."eventId", "finance_receipt_uploads"."id", "finance_receipt_uploads"."status", "finance_receipt_uploads"."tenantId", "finance_receipts"."createdAt"::text, "finance_receipts"."currency", "finance_receipts"."depositAmount", "finance_receipts"."eventId", "finance_receipts"."hasAlcohol", "finance_receipts"."hasDeposit", "finance_receipts"."id", "finance_receipts"."purchaseCountry", "finance_receipts"."receiptDate"::text, "finance_receipts"."refundedAt"::text, "finance_receipts"."refundTransactionId", "finance_receipts"."rejectionReason", "finance_receipts"."reviewedAt"::text, "finance_receipts"."status", "finance_receipts"."submittedByUserId", "finance_receipts"."taxAmount", "finance_receipts"."tenantId", "finance_receipts"."totalAmount", "finance_receipts"."updatedAt"::text, "event_instances"."start"::text, "event_instances"."title", "users"."iban", "users"."paypalEmail", "users"."communicationEmail", "users"."email", "users"."firstName", "users"."lastName" from "finance_receipts" inner join "finance_receipt_uploads" on (("finance_receipts"."attachmentUploadId" = "finance_receipt_uploads"."id") and ("finance_receipts"."tenantId" = "finance_receipt_uploads"."tenantId") and ("finance_receipts"."eventId" = "finance_receipt_uploads"."eventId") and ("finance_receipts"."submittedByUserId" = "finance_receipt_uploads"."uploadedByUserId")) inner join "event_instances" on (("event_instances"."id" = "finance_receipts"."eventId") and ("event_instances"."tenantId" = $1)) inner join "users" on "users"."id" = "finance_receipts"."submittedByUserId" where (("finance_receipts"."tenantId" = $2) and ("finance_receipts"."status" = $3)) order by "users"."lastName", "users"."firstName", "finance_receipts"."createdAt" desc';

const financeDatabaseTimestamp = (value: Date | null) =>
  value === null
    ? null
    : value.toISOString().replace('T', ' ').replace('Z', '');

const receiptEvidenceValues = (receipt: ReceiptEvidenceRow) => [
  receipt.alcoholAmount,
  receipt.attachmentFileName,
  receipt.attachmentMimeType,
  receipt.attachmentStorageKey,
  financeDatabaseTimestamp(receipt.attachmentUploadConsumedAt),
  financeDatabaseTimestamp(receipt.attachmentUploadedAt),
  receipt.attachmentUploadedByUserId,
  receipt.attachmentUploadEventId,
  receipt.attachmentUploadId,
  receipt.attachmentUploadStatus,
  receipt.attachmentUploadTenantId,
  financeDatabaseTimestamp(receipt.createdAt),
  receipt.currency,
  receipt.depositAmount,
  receipt.eventId,
  receipt.hasAlcohol,
  receipt.hasDeposit,
  receipt.id,
  receipt.purchaseCountry,
  receipt.receiptDate,
  financeDatabaseTimestamp(receipt.refundedAt),
  receipt.refundTransactionId,
  receipt.rejectionReason,
  financeDatabaseTimestamp(receipt.reviewedAt),
  receipt.status,
  receipt.submittedByUserId,
  receipt.taxAmount,
  receipt.tenantId,
  receipt.totalAmount,
  financeDatabaseTimestamp(receipt.updatedAt),
];

const receiptReadContext = {
  eventStart: new Date('2026-07-20T10:00:00.000Z'),
  eventTitle: 'Welcome dinner',
  recipientIban: 'DE89370400440532013000',
  recipientPaypalEmail: 'participant@example.test',
  submittedByCommunicationEmail: '',
  submittedByEmail: 'participant@example.test',
  submittedByFirstName: 'Pat',
  submittedByLastName: 'Example',
} satisfies {
  eventStart: GetColumnData<typeof eventInstances.start>;
  eventTitle: GetColumnData<typeof eventInstances.title>;
  recipientIban: GetColumnData<typeof users.iban>;
  recipientPaypalEmail: GetColumnData<typeof users.paypalEmail>;
  submittedByCommunicationEmail: GetColumnData<typeof users.communicationEmail>;
  submittedByEmail: GetColumnData<typeof users.email>;
  submittedByFirstName: GetColumnData<typeof users.firstName>;
  submittedByLastName: GetColumnData<typeof users.lastName>;
};

const createReceiptApprovalDatabase = () => {
  const targetTenantRecord = {
    ...targetTenant,
    createdAt: new Date('2026-07-10T08:00:00.000Z'),
    defaultLocation: targetTenant.defaultLocation ?? null,
    emailSenderEmail: targetTenant.emailSenderEmail ?? null,
    emailSenderName: targetTenant.emailSenderName ?? null,
    faviconUrl: targetTenant.faviconUrl ?? null,
    legalNoticeText: targetTenant.legalNoticeText ?? null,
    legalNoticeUrl: targetTenant.legalNoticeUrl ?? null,
    logoUrl: targetTenant.logoUrl ?? null,
    seoDescription: targetTenant.seoDescription ?? null,
    seoTitle: targetTenant.seoTitle ?? null,
    stripeAccountId: targetTenant.stripeAccountId ?? null,
    termsText: targetTenant.termsText ?? null,
    termsUrl: targetTenant.termsUrl ?? null,
    updatedAt: new Date('2026-07-10T08:00:00.000Z'),
  } satisfies typeof tenants.$inferSelect;
  const transaction = vi.fn<
    NonNullable<
      Parameters<
        typeof createRegistrationDatabaseTestLayer
      >[0]['transactionControl']
    >
  >(() =>
    Effect.die(new Error('Receipt signing failure must precede a transaction')),
  );
  const databaseLayer = createRegistrationDatabaseTestLayer({
    executeValues: (statement, parameters) =>
      Effect.sync(() => {
        if (statement === platformTargetTenantSql) {
          expect(parameters).toEqual([targetTenant.id, 1]);
          return [
            [
              targetTenantRecord.cancellationDeadlineHoursBeforeStart,
              financeDatabaseTimestamp(targetTenantRecord.createdAt),
              targetTenantRecord.currency,
              targetTenantRecord.defaultLocation,
              targetTenantRecord.discountProviders,
              targetTenantRecord.domain,
              targetTenantRecord.emailSenderEmail,
              targetTenantRecord.emailSenderName,
              targetTenantRecord.faviconUrl,
              targetTenantRecord.id,
              targetTenantRecord.legalNoticeText,
              targetTenantRecord.legalNoticeUrl,
              targetTenantRecord.logoUrl,
              targetTenantRecord.maxActiveRegistrationsPerUser,
              targetTenantRecord.name,
              targetTenantRecord.receiptSettings,
              targetTenantRecord.refundFeesOnCancellation,
              targetTenantRecord.seoDescription,
              targetTenantRecord.seoTitle,
              targetTenantRecord.stripeAccountId,
              targetTenantRecord.termsText,
              targetTenantRecord.termsUrl,
              targetTenantRecord.theme,
              targetTenantRecord.timezone,
              targetTenantRecord.transferDeadlineHoursBeforeStart,
              financeDatabaseTimestamp(targetTenantRecord.updatedAt),
            ],
          ];
        }
        if (statement === receiptApprovalEvidenceSql) {
          expect(parameters).toEqual([
            submittedReceiptEvidence.id,
            targetTenant.id,
            1,
          ]);
          return [receiptEvidenceValues(submittedReceiptEvidence)];
        }
        if (
          statement === receiptApprovalDetailSql ||
          statement === receiptApprovalQueueSql ||
          statement === receiptReimbursementQueueSql
        ) {
          const reimbursement = statement === receiptReimbursementQueueSql;
          expect(parameters).toEqual(
            statement === receiptApprovalDetailSql
              ? [
                  targetTenant.id,
                  submittedReceiptEvidence.id,
                  targetTenant.id,
                  1,
                ]
              : [
                  targetTenant.id,
                  targetTenant.id,
                  reimbursement ? 'approved' : 'submitted',
                ],
          );
          const receipt: ReceiptEvidenceRow = {
            ...submittedReceiptEvidence,
            status: reimbursement ? 'approved' : 'submitted',
          };
          return [
            [
              ...receiptEvidenceValues(receipt),
              financeDatabaseTimestamp(receiptReadContext.eventStart),
              receiptReadContext.eventTitle,
              ...(reimbursement
                ? [
                    receiptReadContext.recipientIban,
                    receiptReadContext.recipientPaypalEmail,
                  ]
                : []),
              receiptReadContext.submittedByCommunicationEmail,
              receiptReadContext.submittedByEmail,
              receiptReadContext.submittedByFirstName,
              receiptReadContext.submittedByLastName,
            ],
          ];
        }
        throw new Error(
          `Unexpected platform receipt approval SQL: ${statement}`,
        );
      }),
    transactionControl: transaction,
  });

  return { databaseLayer, transaction };
};

type PlatformTransactionRow = Parameters<
  typeof toPlatformFinanceTransactionRecord
>[0];

const platformTransactionRow = (
  overrides: Partial<PlatformTransactionRow> = {},
): PlatformTransactionRow => ({
  amount: -1200,
  appFee: null,
  comment: 'Registration refund',
  createdAt: new Date('2026-07-10T10:00:00.000Z'),
  currency: 'EUR',
  eventRegistrationId: 'registration-1',
  id: 'refund-claim-1',
  manuallyCreated: false,
  method: 'stripe',
  sourceTransactionId: 'source-transaction-1',
  status: 'pending',
  stripeFee: null,
  stripeRefundAttempts: 0,
  stripeRefundClaimLeaseExpiresAt: null,
  stripeRefundClaimLeaseId: null,
  stripeRefundId: null,
  stripeRefundMaxAttempts: 8,
  stripeRefundNextAttemptAt: new Date('2026-07-10T10:01:00.000Z'),
  stripeRefundRequeuedAt: null,
  stripeRefundStatus: null,
  type: 'refund',
  ...overrides,
});

describe('platform tenant finance handlers', () => {
  it('exports only the dedicated target-scoped finance methods', () => {
    expect(Object.keys(platformTenantFinanceHandlers).toSorted()).toEqual([
      'platform.finance.checkoutClaims.recover',
      'platform.finance.checkoutClaims.recoveryQueue',
      'platform.finance.receipts.approvalDetail',
      'platform.finance.receipts.approvalQueue',
      'platform.finance.receipts.recordReimbursement',
      'platform.finance.receipts.reimbursementQueue',
      'platform.finance.receipts.review',
      'platform.finance.refundClaims.recoveryQueue',
      'platform.finance.refundClaims.requeue',
      'platform.finance.transactions.findMany',
    ]);
  });

  it('keeps reusable finance workflows on named Effect boundaries', () => {
    const source = readFileSync(
      new URL('platform-tenant-finance.handlers.ts', import.meta.url),
      'utf8',
    );

    for (const operationName of [
      'PlatformTenantFinance.recordReimbursement',
      'PlatformTenantFinance.requeueRefundClaim',
      'PlatformTenantFinance.reviewReceipt',
      'PlatformTenantFinance.runPlatformRead',
      'PlatformTenantFinance.validateReceiptReviewInput',
    ]) {
      expect(source).toContain(`'${operationName}'`);
    }
  });

  it.effect('maps refund requeue domain errors to a bad request', () =>
    Effect.gen(function* () {
      const error = yield* mapPlatformRefundRequeueError(
        new RegistrationRefundRequeueError({
          message: 'An active refund claim cannot be requeued',
          refundClaimId: 'refund-claim-1',
        }),
      ).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: 'RpcBadRequestError',
        reason: 'refundRequeueNotAllowed',
      });
    }),
  );

  it.effect('preserves unexpected refund requeue failures as defects', () =>
    Effect.gen(function* () {
      const unexpected = new Error('database unavailable');
      const exit = yield* mapPlatformRefundRequeueError(unexpected).pipe(
        Effect.exit,
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toBe(unexpected);
      }
    }),
  );

  it('joins the scoped upload for every platform receipt media read', () => {
    const source = readFileSync(
      new URL('platform-tenant-finance.handlers.ts', import.meta.url),
      'utf8',
    );

    const scopedUploadJoinCount =
      source.split(
        '.innerJoin(financeReceiptUploads, financeReceiptUploadJoin)',
      ).length - 1;

    expect(scopedUploadJoinCount).toBe(5);
  });

  it('keeps exhausted stale-schedule refunds visible to recovery', () => {
    const source = readFileSync(
      new URL('platform-tenant-finance.handlers.ts', import.meta.url),
      'utf8',
    );

    expect(source).toMatch(
      /or\(\s*isNull\(transactions\.stripeRefundNextAttemptAt\),\s*gte\(\s*transactions\.stripeRefundAttempts,\s*transactions\.stripeRefundMaxAttempts/u,
    );
  });

  it('loads refund recovery context through target-tenant registration and event joins', () => {
    const source = readFileSync(
      new URL('platform-tenant-finance.handlers.ts', import.meta.url),
      'utf8',
    );
    const recoveryQueueStart = source.indexOf(
      "'platform.finance.refundClaims.recoveryQueue'",
    );
    const recoveryQueueEnd = source.indexOf(
      "'platform.finance.refundClaims.requeue'",
      recoveryQueueStart,
    );
    const recoveryQueueSource = source.slice(
      recoveryQueueStart,
      recoveryQueueEnd,
    );

    expect(recoveryQueueSource).toContain('attendeeFirstName: users.firstName');
    expect(recoveryQueueSource).toContain('eventTitle: eventInstances.title');
    expect(recoveryQueueSource).toMatch(
      /eq\(eventRegistrations\.tenantId, input\.targetTenantId\)/u,
    );
    expect(recoveryQueueSource).toMatch(
      /eq\(eventInstances\.tenantId, input\.targetTenantId\)/u,
    );
    expect(recoveryQueueSource).toContain(
      "runPlatformRead(\n      input.targetTenantId,\n      'finance:refundReceipts'",
    );
  });

  it('checks evidence only for approval and revalidates it under the mutation lock', () => {
    const source = readFileSync(
      new URL('platform-tenant-finance.handlers.ts', import.meta.url),
      'utf8',
    );
    const approvalCheck = source.indexOf("input.status === 'approved'");
    const evidenceLoad = source.indexOf(
      'loadReceiptEvidenceForApproval(',
      approvalCheck,
    );
    const transactionStart = source.indexOf(
      'database.transaction(',
      evidenceLoad,
    );
    const lockedEvidence = source.indexOf(
      'hasValidReceiptUploadBinding(lockedEvidence)',
      transactionStart,
    );
    const receiptUpdate = source.indexOf(
      '.update(financeReceipts)',
      lockedEvidence,
    );

    expect(approvalCheck).toBeGreaterThan(-1);
    expect(evidenceLoad).toBeGreaterThan(approvalCheck);
    expect(transactionStart).toBeGreaterThan(evidenceLoad);
    expect(lockedEvidence).toBeGreaterThan(transactionStart);
    expect(receiptUpdate).toBeGreaterThan(lockedEvidence);
  });

  it.effect(
    'returns a typed storage outage before mutating a platform approval',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, transaction } = createReceiptApprovalDatabase();
        const objectExists = vi.fn<
          Context.Service.Shape<typeof ReceiptMediaService>['objectExists']
        >(() =>
          Effect.fail(
            new ReceiptMediaServiceUnavailableError({
              message: 'Receipt storage is unavailable',
            }),
          ),
        );
        const signedPreviewUrl = vi.fn<
          Context.Service.Shape<typeof ReceiptMediaService>['signedPreviewUrl']
        >(() => Effect.die(new Error('Approval must not sign a preview URL')));
        const error = yield* platformTenantFinanceHandlers[
          'platform.finance.receipts.review'
        ](
          {
            alcoholAmount: 0,
            depositAmount: 0,
            hasAlcohol: false,
            hasDeposit: false,
            id: 'receipt-1',
            purchaseCountry: 'DE',
            reason: 'Review submitted evidence',
            receiptDate: '2026-07-09',
            status: 'approved',
            targetTenantId: 'tenant-1',
            taxAmount: 190,
            totalAmount: 1190,
          },
          {
            client: new Rpc.ServerClient(1),
            headers: Headers.empty,
            requestId: RpcMessage.RequestId(1),
            rpc: PlatformFinanceReceiptReview.middleware(
              RpcRequestContextMiddleware,
            ),
          },
        ).pipe(
          Effect.flip,
          Effect.provide(
            Layer.mergeAll(
              RpcAccess.Default,
              Layer.succeed(RpcRequestContext, {
                authData: { sub: platformAuthority.actorId },
                authenticated: true,
                permissions: [],
                platformAuthority,
                tenant: targetTenant,
                user: null,
                userAssigned: false,
              }),
              databaseLayer,
              Layer.succeed(ReceiptMediaService, {
                createUploadPolicy: () =>
                  Effect.die(new Error('Unexpected receipt upload')),
                discardPromotedUpload: () =>
                  Effect.die(new Error('Unexpected promoted upload discard')),
                inspectUpload: () =>
                  Effect.die(new Error('Unexpected receipt inspection')),
                objectExists,
                promoteUpload: () =>
                  Effect.die(new Error('Unexpected receipt promotion')),
                signedPreviewUrl,
              }),
            ),
          ),
        );

        expect(error['_tag']).toBe('ReceiptMediaServiceUnavailableError');
        expect(error.message).toBe('Receipt storage is unavailable');
        expect(transaction).not.toHaveBeenCalled();
        expect(objectExists).toHaveBeenCalledOnce();
        expect(objectExists).toHaveBeenCalledWith({
          storageKey: submittedReceiptEvidence.attachmentStorageKey,
        });
        expect(signedPreviewUrl).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'does not call receipt storage for platform approval and reimbursement queues',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, transaction } = createReceiptApprovalDatabase();
        const objectExists = vi.fn<
          Context.Service.Shape<typeof ReceiptMediaService>['objectExists']
        >(() => Effect.die(new Error('Queue must not check receipt storage')));
        const signedPreviewUrl = vi.fn<
          Context.Service.Shape<typeof ReceiptMediaService>['signedPreviewUrl']
        >(() => Effect.die(new Error('Queue must not sign receipt previews')));
        const layer = Layer.mergeAll(
          RpcAccess.Default,
          Layer.succeed(RpcRequestContext, {
            authData: { sub: platformAuthority.actorId },
            authenticated: true,
            permissions: [],
            platformAuthority,
            tenant: targetTenant,
            user: null,
            userAssigned: false,
          }),
          databaseLayer,
          Layer.succeed(ReceiptMediaService, {
            createUploadPolicy: () =>
              Effect.die(new Error('Unexpected receipt upload')),
            discardPromotedUpload: () =>
              Effect.die(new Error('Unexpected promoted upload discard')),
            inspectUpload: () =>
              Effect.die(new Error('Unexpected receipt inspection')),
            objectExists,
            promoteUpload: () =>
              Effect.die(new Error('Unexpected receipt promotion')),
            signedPreviewUrl,
          }),
        );
        const approvalQueue = yield* platformTenantFinanceHandlers[
          'platform.finance.receipts.approvalQueue'
        ](
          { targetTenantId: targetTenant.id },
          {
            client: new Rpc.ServerClient(1),
            headers: Headers.empty,
            requestId: RpcMessage.RequestId(1),
            rpc: PlatformFinanceReceiptApprovalQueue.middleware(
              RpcRequestContextMiddleware,
            ),
          },
        ).pipe(Effect.provide(layer));
        const reimbursementQueue = yield* platformTenantFinanceHandlers[
          'platform.finance.receipts.reimbursementQueue'
        ](
          { targetTenantId: targetTenant.id },
          {
            client: new Rpc.ServerClient(1),
            headers: Headers.empty,
            requestId: RpcMessage.RequestId(2),
            rpc: PlatformFinanceReimbursementQueue.middleware(
              RpcRequestContextMiddleware,
            ),
          },
        ).pipe(Effect.provide(layer));

        expect(approvalQueue.groups).toHaveLength(1);
        expect(approvalQueue.groups[0]?.receipts[0]).not.toHaveProperty(
          'previewImageUrl',
        );
        expect(approvalQueue.groups[0]?.receipts[0]).toMatchObject({
          receiptDate: '2026-07-09',
          submittedByEmail: receiptReadContext.submittedByEmail,
        });
        expect(reimbursementQueue.groups).toHaveLength(1);
        expect(reimbursementQueue.groups[0]?.receipts[0]).not.toHaveProperty(
          'receiptEvidenceAvailable',
        );
        expect(reimbursementQueue.groups[0]).toMatchObject({
          currency: 'EUR',
          submittedByEmail: receiptReadContext.submittedByEmail,
          totalAmount: submittedReceiptEvidence.totalAmount,
        });
        expect(objectExists).not.toHaveBeenCalled();
        expect(signedPreviewUrl).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'propagates a preview signing outage from platform receipt detail',
    () =>
      Effect.gen(function* () {
        const { databaseLayer, transaction } = createReceiptApprovalDatabase();
        const objectExists = vi.fn<
          Context.Service.Shape<typeof ReceiptMediaService>['objectExists']
        >(() => Effect.succeed(true));
        const signedPreviewUrl = vi.fn<
          Context.Service.Shape<typeof ReceiptMediaService>['signedPreviewUrl']
        >(() =>
          Effect.fail(
            new ReceiptMediaServiceUnavailableError({
              message: 'Receipt storage is unavailable',
            }),
          ),
        );
        const error = yield* platformTenantFinanceHandlers[
          'platform.finance.receipts.approvalDetail'
        ](
          { id: submittedReceiptEvidence.id, targetTenantId: targetTenant.id },
          {
            client: new Rpc.ServerClient(1),
            headers: Headers.empty,
            requestId: RpcMessage.RequestId(1),
            rpc: PlatformFinanceReceiptApprovalDetail.middleware(
              RpcRequestContextMiddleware,
            ),
          },
        ).pipe(
          Effect.flip,
          Effect.provide(
            Layer.mergeAll(
              RpcAccess.Default,
              Layer.succeed(RpcRequestContext, {
                authData: { sub: platformAuthority.actorId },
                authenticated: true,
                permissions: [],
                platformAuthority,
                tenant: targetTenant,
                user: null,
                userAssigned: false,
              }),
              databaseLayer,
              Layer.succeed(ReceiptMediaService, {
                createUploadPolicy: () =>
                  Effect.die(new Error('Unexpected receipt upload')),
                discardPromotedUpload: () =>
                  Effect.die(new Error('Unexpected promoted upload discard')),
                inspectUpload: () =>
                  Effect.die(new Error('Unexpected receipt inspection')),
                objectExists,
                promoteUpload: () =>
                  Effect.die(new Error('Unexpected receipt promotion')),
                signedPreviewUrl,
              }),
            ),
          ),
        );

        expect(error['_tag']).toBe('ReceiptMediaServiceUnavailableError');
        expect(error.message).toBe('Receipt storage is unavailable');
        expect(objectExists).toHaveBeenCalledOnce();
        expect(objectExists).toHaveBeenCalledWith({
          storageKey: submittedReceiptEvidence.attachmentStorageKey,
        });
        expect(signedPreviewUrl).toHaveBeenCalledOnce();
        expect(signedPreviewUrl).toHaveBeenCalledWith({
          expiresInSeconds: 900,
          storageKey: submittedReceiptEvidence.attachmentStorageKey,
        });
        expect(transaction).not.toHaveBeenCalled();
      }),
  );

  it('constructs every nested finance RPC class at its handler boundary', () => {
    const source = readFileSync(
      new URL('platform-tenant-finance.handlers.ts', import.meta.url),
      'utf8',
    );

    for (const constructor of [
      'PlatformFinanceReceiptApprovalDetailRecord.make',
      'PlatformFinanceReceiptApprovalGroup.make',
      'PlatformFinanceReceiptWithSubmitterRecord.make',
      'PlatformFinanceReimbursementGroup.make',
      'PlatformFinanceReimbursementReceipt.make',
    ]) {
      expect(source).toContain(constructor);
    }
  });

  it('versions payout details without sending them back in a mutation or audit', () => {
    const first = payoutDetailsVersion('iban', 'DE89370400440532013000');
    const sameCanonical = payoutDetailsVersion(
      'iban',
      'DE89370400440532013000',
    );
    const changed = payoutDetailsVersion('iban', 'NL91ABNA0417164300');

    expect(first).toBe(sameCanonical);
    expect(() =>
      payoutDetailsVersion('iban', ' DE89 3704 0044 0532 0130 00 '),
    ).toThrow(/non-canonical iban/u);
    expect(() =>
      payoutDetailsVersion('paypal', 'Participant@Example.Test'),
    ).toThrow(/non-canonical paypal/u);
    expect(first).not.toBe(changed);
    expect(first).toMatch(/^[a-f\d]{64}$/u);
  });

  it('allows only a newly submitted receipt to be reviewed', () => {
    expect(canPlatformReviewReceipt('submitted')).toBe(true);
    expect(canPlatformReviewReceipt('approved')).toBe(false);
    expect(canPlatformReviewReceipt('rejected')).toBe(false);
    expect(canPlatformReviewReceipt('refunded')).toBe(false);
  });

  it('leaves tenant-user reviewer and reimbursement actor foreign keys null', () => {
    const reviewedAt = new Date('2026-07-10T10:00:00.000Z');
    expect(
      platformReceiptReviewUpdate({
        alcoholAmount: 0,
        depositAmount: 0,
        hasAlcohol: false,
        hasDeposit: false,
        purchaseCountry: 'DE',
        receiptDate: '2026-07-09',
        rejectionReason: null,
        reviewedAt,
        status: 'approved',
        taxAmount: 100,
        totalAmount: 1000,
      }).reviewedByUserId,
    ).toBeNull();

    const transaction = platformReimbursementTransactionInsert({
      currency: 'CZK',
      eventCount: 1,
      eventId: 'event-1',
      payoutType: 'iban',
      receiptCount: 1,
      targetTenantId: 'tenant-1',
      targetUserId: 'user-1',
      totalAmount: 1000,
    });
    expect(transaction.executiveUserId).toBeNull();
    expect(transaction.currency).toBe('CZK');
    expect(transaction.comment).toBe(
      'Receipt reimbursement recorded by an Evorto administrator via bank transfer for 1 receipt across 1 event',
    );
    expect(transaction).not.toHaveProperty('payoutReference');

    expect(
      platformReimbursementReceiptUpdate({
        refundedAt: reviewedAt,
        transactionId: 'transaction-1',
      }).refundedByUserId,
    ).toBeNull();
  });

  it('creates a typed reimbursement audit envelope without payout or participant PII', () => {
    const payoutFingerprint = payoutDetailsVersion(
      'paypal',
      'participant@example.test',
    );
    const snapshot = reimbursementAuditSnapshot({
      currency: 'EUR',
      payoutDestinationMasked: 'p•••@e•••.test',
      payoutFingerprint,
      payoutType: 'paypal',
      receiptIds: ['receipt-1', 'receipt-2'],
      refundedAt: new Date('2026-07-10T10:00:00.000Z'),
      status: 'refunded',
      totalAmount: 2000,
      transactionId: 'transaction-1',
    });

    expect(snapshot).toEqual({
      resourceId: 'receipt-1',
      resourceType: 'receipt',
      state: {
        currency: 'EUR',
        payoutDestinationMasked: 'p•••@e•••.test',
        payoutFingerprint,
        payoutType: 'paypal',
        receiptCount: 2,
        receiptIds: ['receipt-1', 'receipt-2'],
        refundedAt: '2026-07-10T10:00:00.000Z',
        status: 'refunded',
        totalAmount: 2000,
        transactionId: 'transaction-1',
      },
    });

    const encoded = JSON.stringify(snapshot);
    expect(encoded).not.toContain('participant@example.test');
    for (const forbiddenField of [
      'email',
      'iban',
      'paypalEmail',
      'payoutReference',
      'previewImageUrl',
      'storageKey',
    ]) {
      expect(encoded).not.toContain(forbiddenField);
    }
  });

  it.effect('accepts only one recorded currency per reimbursement batch', () =>
    Effect.gen(function* () {
      const sameCurrency = resolveFinanceReimbursementBatch([
        { currency: 'CZK', submittedByUserId: 'user-1', totalAmount: 100 },
        { currency: 'CZK', submittedByUserId: 'user-1', totalAmount: 200 },
      ]);
      expect(sameCurrency.currency).toBe('CZK');
      expect(sameCurrency.error).toBeNull();
      expect(sameCurrency.totalAmount).toBe(300);

      const mixedCurrency = resolveFinanceReimbursementBatch([
        { currency: 'EUR', submittedByUserId: 'user-1', totalAmount: 100 },
        { currency: 'AUD', submittedByUserId: 'user-1', totalAmount: 200 },
      ]);
      if (!mixedCurrency.error) {
        return yield* Effect.die(new Error('Expected mixed-currency denial'));
      }
      const error = new RpcBadRequestError(mixedCurrency.error);
      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error).toMatchObject({ reason: 'mismatchedReceiptCurrency' });
    }),
  );

  it('audits refund recovery mode and state without error text or Stripe identifiers', () => {
    const snapshot = refundRecoveryAuditSnapshot({
      amount: 1200,
      currency: 'EUR',
      eventId: 'event-1',
      eventRegistrationId: 'registration-1',
      hasLastError: true,
      maxAttempts: 8,
      mode: 'newGeneration',
      refundClaimId: 'refund-claim-1',
      sourceTransactionId: 'source-transaction-1',
      state: {
        attempts: 8,
        generation: 0,
        refundId: 're_secret',
        status: 'pending',
        stripeRefundStatus: 'failed',
      },
      transferId: 'transfer-1',
      transferStatus: 'refund_failed',
    });

    expect(snapshot).toMatchObject({
      resourceId: 'refund-claim-1',
      resourceType: 'refundClaim',
      state: {
        hasLastError: true,
        hasRefundId: true,
        mode: 'newGeneration',
        transferStatus: 'refund_failed',
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain('re_secret');
    expect(snapshot.state).not.toHaveProperty('lastError');

    const compensationSnapshot = refundRecoveryAuditSnapshot({
      amount: 1200,
      currency: 'EUR',
      eventId: 'event-1',
      eventRegistrationId: 'recipient-registration-1',
      hasLastError: true,
      maxAttempts: 8,
      mode: 'newGeneration',
      refundClaimId: 'compensation-claim-1',
      sourceTransactionId: 'recipient-payment-1',
      state: {
        attempts: 1,
        generation: 0,
        refundId: 're_compensation',
        status: 'pending',
        stripeRefundStatus: 'failed',
      },
      transferId: 'transfer-1',
      transferStatus: 'compensation_failed',
    });
    expect(compensationSnapshot.state).toMatchObject({
      transferStatus: 'compensation_failed',
    });
  });

  it('encodes recovery queue records through the RPC success schema', () => {
    const recovery = toRefundRecoveryRecord({
      amount: -1800,
      attempts: 8,
      attendeeFirstName: 'Pat',
      attendeeLastName: 'Example',
      createdAt: new Date('2026-07-10T10:00:00.000Z'),
      currency: 'EUR',
      eventId: 'event-1',
      eventRegistrationId: 'source-registration-1',
      eventTitle: 'Welcome dinner',
      generation: 0,
      lastError: 'Terminal Stripe refund failure',
      leaseExpiresAt: null,
      leaseId: null,
      maxAttempts: 8,
      nextAttemptAt: null,
      refundClaimId: 'refund-claim-1',
      refundId: 're_failed',
      sourceTransactionId: 'source-transaction-1',
      status: 'pending',
      stripeRefundStatus: 'failed',
      transferEventId: 'event-1',
      transferId: 'transfer-1',
      transferSourceRegistrationId: 'source-registration-1',
      transferStatus: 'refund_failed',
      updatedAt: new Date('2026-07-10T11:00:00.000Z'),
    });
    if (!recovery) {
      throw new Error('Expected an eligible refund recovery record');
    }

    expect(
      Schema.encodeUnknownSync(
        PlatformFinanceRefundRecoveryQueue.successSchema,
      )({
        claims: [recovery],
        tenantContext: PlatformFinanceTenantContext.make({
          currency: 'EUR',
          receiptCountryConfig: { allowOther: false, receiptCountries: [] },
          targetTenantId: 'tenant-1',
          timezone: 'Australia/Brisbane',
        }),
      }),
    ).toEqual({
      claims: [
        {
          amount: 1800,
          attendeeFirstName: 'Pat',
          attendeeLastName: 'Example',
          createdAt: '2026-07-10T10:00:00.000Z',
          currency: 'EUR',
          eventId: 'event-1',
          eventRegistrationId: 'source-registration-1',
          eventTitle: 'Welcome dinner',
          id: 'refund-claim-1',
          lastError: 'Terminal Stripe refund failure',
          mode: 'newGeneration',
          sourceTransactionId: 'source-transaction-1',
          stripeRefundAttempts: 8,
          stripeRefundGeneration: 0,
          stripeRefundMaxAttempts: 8,
          stripeRefundStatus: 'failed',
          transfer: {
            eventId: 'event-1',
            id: 'transfer-1',
            sourceRegistrationId: 'source-registration-1',
            status: 'refund_failed',
          },
          updatedAt: '2026-07-10T11:00:00.000Z',
        },
      ],
      tenantContext: {
        currency: 'EUR',
        receiptCountryConfig: { allowOther: false, receiptCountries: [] },
        targetTenantId: 'tenant-1',
        timezone: 'Australia/Brisbane',
      },
    });

    const orphaned = toRefundRecoveryRecord({
      amount: -1800,
      attempts: 1,
      attendeeFirstName: 'Pat',
      attendeeLastName: 'Example',
      createdAt: new Date('2026-07-10T10:00:00.000Z'),
      currency: 'EUR',
      eventId: 'event-1',
      eventRegistrationId: 'source-registration-1',
      eventTitle: 'Welcome dinner',
      generation: 0,
      lastError: 'Worker stopped before scheduling the next attempt',
      leaseExpiresAt: null,
      leaseId: null,
      maxAttempts: 8,
      nextAttemptAt: null,
      refundClaimId: 'orphaned-refund-claim-1',
      refundId: null,
      sourceTransactionId: 'source-transaction-1',
      status: 'pending',
      stripeRefundStatus: null,
      transferEventId: null,
      transferId: null,
      transferSourceRegistrationId: null,
      transferStatus: null,
      updatedAt: new Date('2026-07-10T11:00:00.000Z'),
    });

    expect(orphaned).toBeNull();
  });

  it('derives safe platform refund lifecycle states at the handler boundary', () => {
    const pending = toPlatformFinanceTransactionRecord(
      platformTransactionRow(),
    );
    const retrying = toPlatformFinanceTransactionRecord(
      platformTransactionRow({
        stripeRefundAttempts: 2,
        stripeRefundNextAttemptAt: new Date('2026-07-10T10:05:00.000Z'),
      }),
    );
    const succeeded = toPlatformFinanceTransactionRecord(
      platformTransactionRow({
        status: 'successful',
        stripeRefundAttempts: 1,
        stripeRefundNextAttemptAt: null,
        stripeRefundStatus: 'succeeded',
      }),
    );
    const unsupportedManual = toPlatformFinanceTransactionRecord(
      platformTransactionRow({
        manuallyCreated: true,
        method: 'transfer',
        stripeRefundNextAttemptAt: null,
      }),
    );
    const exhausted = toPlatformFinanceTransactionRecord(
      platformTransactionRow({
        stripeRefundAttempts: 8,
        stripeRefundNextAttemptAt: null,
      }),
    );
    const recoverableStopped = toPlatformFinanceTransactionRecord(
      platformTransactionRow({
        stripeRefundAttempts: 8,
        stripeRefundId: 're_stopped-refund-1',
        stripeRefundNextAttemptAt: null,
        stripeRefundStatus: 'pending',
      }),
    );
    const orphaned = toPlatformFinanceTransactionRecord(
      platformTransactionRow({
        stripeRefundAttempts: 1,
        stripeRefundNextAttemptAt: null,
      }),
    );
    const untouchedOrphan = toPlatformFinanceTransactionRecord(
      platformTransactionRow({
        stripeRefundAttempts: 0,
        stripeRefundNextAttemptAt: null,
      }),
    );
    const exhaustedWithStaleSchedule = toPlatformFinanceTransactionRecord(
      platformTransactionRow({
        stripeRefundAttempts: 8,
        stripeRefundNextAttemptAt: new Date('2026-07-10T10:05:00.000Z'),
        stripeRefundStatus: 'pending',
      }),
    );
    const requeued = toPlatformFinanceTransactionRecord(
      platformTransactionRow({
        stripeRefundAttempts: 0,
        stripeRefundRequeuedAt: new Date('2026-07-10T10:04:00.000Z'),
      }),
    );
    const actionRequired = toPlatformFinanceTransactionRecord(
      platformTransactionRow({
        stripeRefundAttempts: 1,
        stripeRefundStatus: 'requires_action',
      }),
    );
    const recoverableActionRequired = toPlatformFinanceTransactionRecord(
      platformTransactionRow({
        stripeRefundAttempts: 8,
        stripeRefundId: 're_action-required-1',
        stripeRefundNextAttemptAt: null,
        stripeRefundStatus: 'requires_action',
      }),
    );
    const stillLeased = toPlatformFinanceTransactionRecord(
      platformTransactionRow({
        stripeRefundAttempts: 8,
        stripeRefundClaimLeaseExpiresAt: new Date('2026-07-10T10:10:00.000Z'),
        stripeRefundClaimLeaseId: 'lease-1',
        stripeRefundNextAttemptAt: null,
      }),
    );
    const ambiguousLease = toPlatformFinanceTransactionRecord(
      platformTransactionRow({
        stripeRefundAttempts: 1,
        stripeRefundClaimLeaseId: 'partial-lease',
        stripeRefundNextAttemptAt: null,
        stripeRefundStatus: 'requires_action',
      }),
    );
    const terminal = toPlatformFinanceTransactionRecord(
      platformTransactionRow({
        stripeRefundAttempts: 1,
        stripeRefundNextAttemptAt: null,
        stripeRefundStatus: 'failed',
      }),
    );
    const recoverableTerminal = toPlatformFinanceTransactionRecord(
      platformTransactionRow({
        stripeRefundAttempts: 1,
        stripeRefundId: 're_refund-1',
        stripeRefundNextAttemptAt: null,
        stripeRefundStatus: 'failed',
      }),
    );
    const missingSource = toPlatformFinanceTransactionRecord(
      platformTransactionRow({
        sourceTransactionId: null,
        stripeRefundAttempts: 8,
        stripeRefundNextAttemptAt: null,
      }),
    );
    const cancelled = toPlatformFinanceTransactionRecord(
      platformTransactionRow({
        manuallyCreated: true,
        method: 'transfer',
        status: 'cancelled',
        stripeRefundNextAttemptAt: null,
      }),
    );

    expect(pending.refundLifecycle).toMatchObject({
      recoveryMode: null,
      status: 'pending',
    });
    expect(retrying.refundLifecycle).toMatchObject({
      recoveryMode: null,
      status: 'retrying',
    });
    expect(succeeded.refundLifecycle).toMatchObject({
      recoveryMode: null,
      status: 'succeeded',
    });
    expect(unsupportedManual.refundLifecycle).toMatchObject({
      attempts: null,
      maxAttempts: null,
      recoveryMode: null,
      status: 'needs-attention',
    });
    expect(exhausted.refundLifecycle).toMatchObject({
      recoveryMode: null,
      status: 'needs-attention',
    });
    expect(recoverableStopped.refundLifecycle).toMatchObject({
      recoveryMode: 'resumeGeneration',
      status: 'needs-attention',
    });
    expect(orphaned.refundLifecycle).toMatchObject({
      recoveryMode: null,
      status: 'needs-attention',
    });
    expect(untouchedOrphan.refundLifecycle).toMatchObject({
      recoveryMode: 'resumeGeneration',
      status: 'needs-attention',
    });
    expect(exhaustedWithStaleSchedule.refundLifecycle).toMatchObject({
      recoveryMode: null,
      status: 'needs-attention',
    });
    expect(requeued.refundLifecycle).toMatchObject({
      recoveryMode: null,
      status: 'retrying',
    });
    expect(actionRequired.refundLifecycle).toMatchObject({
      recoveryMode: null,
      status: 'action-required',
    });
    expect(recoverableActionRequired.refundLifecycle).toMatchObject({
      recoveryMode: 'resumeGeneration',
      status: 'action-required',
    });
    expect(stillLeased.refundLifecycle).toMatchObject({
      recoveryMode: null,
      status: 'retrying',
    });
    expect(ambiguousLease.refundLifecycle).toMatchObject({
      recoveryMode: null,
      status: 'needs-attention',
    });
    expect(terminal.refundLifecycle).toMatchObject({
      recoveryMode: null,
      status: 'needs-attention',
    });
    expect(recoverableTerminal.refundLifecycle).toMatchObject({
      recoveryMode: 'newGeneration',
      status: 'needs-attention',
    });
    expect(missingSource.refundLifecycle).toMatchObject({
      recoveryMode: null,
      status: 'needs-attention',
    });
    expect(cancelled.refundLifecycle).toMatchObject({
      recoveryMode: null,
      status: 'needs-attention',
    });

    const encoded = Schema.encodeUnknownSync(
      PlatformFinanceTransactionsFindMany.successSchema,
    )({
      data: [
        pending,
        retrying,
        succeeded,
        unsupportedManual,
        exhausted,
        recoverableStopped,
        orphaned,
        untouchedOrphan,
        exhaustedWithStaleSchedule,
        requeued,
        actionRequired,
        recoverableActionRequired,
        terminal,
        recoverableTerminal,
        ambiguousLease,
        missingSource,
        cancelled,
      ],
      tenantContext: tenantContext(),
      total: 17,
    });
    expect(JSON.stringify(encoded)).not.toContain('LastError');
    expect(JSON.stringify(encoded)).not.toContain('provider');
  });

  it('encodes an approval detail record through the RPC success schema', () => {
    const receipt = PlatformFinanceReceiptApprovalDetailRecord.make({
      ...receiptWithSubmitterInput('submitted'),
      eventStart: '2026-07-20T10:00:00.000Z',
      eventTitle: 'Welcome event',
      previewImageUrl: 'https://example.test/receipt.pdf',
      receiptEvidenceAvailable: true,
    });

    expect(
      Schema.encodeUnknownSync(
        PlatformFinanceReceiptApprovalDetail.successSchema,
      )({ receipt, tenantContext: tenantContext() }),
    ).toMatchObject({
      receipt: {
        eventTitle: 'Welcome event',
        id: 'receipt-1',
        status: 'submitted',
      },
      tenantContext: { targetTenantId: 'tenant-1' },
    });
  });

  it('encodes approval queue groups and receipts through the RPC success schema', () => {
    const receipt = PlatformFinanceReceiptWithSubmitterRecord.make(
      receiptWithSubmitterInput('submitted'),
    );
    const group = PlatformFinanceReceiptApprovalGroup.make({
      eventId: 'event-1',
      eventStart: '2026-07-20T10:00:00.000Z',
      eventTitle: 'Welcome event',
      receipts: [receipt],
    });

    expect(
      Schema.encodeUnknownSync(
        PlatformFinanceReceiptApprovalQueue.successSchema,
      )({ groups: [group], tenantContext: tenantContext() }),
    ).toMatchObject({
      groups: [
        {
          eventId: 'event-1',
          receipts: [{ id: 'receipt-1', status: 'submitted' }],
        },
      ],
      tenantContext: { targetTenantId: 'tenant-1' },
    });
  });

  it('encodes reimbursement groups and receipts through the RPC success schema', () => {
    const receipt = PlatformFinanceReimbursementReceipt.make({
      ...receiptWithSubmitterInput('approved'),
      eventStart: '2026-07-20T10:00:00.000Z',
      eventTitle: 'Welcome event',
    });
    const group = PlatformFinanceReimbursementGroup.make({
      currency: 'EUR',
      payout: { iban: 'DE89370400440532013000', paypalEmail: null },
      payoutVersions: { iban: 'payout-version-1', paypal: null },
      receipts: [receipt],
      submittedByEmail: 'participant@example.test',
      submittedByFirstName: 'Pat',
      submittedByLastName: 'Example',
      submittedByUserId: 'user-1',
      totalAmount: 1190,
    });

    expect(
      Schema.encodeUnknownSync(PlatformFinanceReimbursementQueue.successSchema)(
        { groups: [group], tenantContext: tenantContext() },
      ),
    ).toMatchObject({
      groups: [
        {
          currency: 'EUR',
          receipts: [{ id: 'receipt-1', status: 'approved' }],
          submittedByUserId: 'user-1',
        },
      ],
      tenantContext: { targetTenantId: 'tenant-1' },
    });
  });
});

describe('existing Checkout recovery validation', () => {
  const createdAt = new Date(1_900_000_000_000);
  const snapshot = {
    customerEmail: 'attendee@example.org',
    eventTitle: 'City tour',
    eventUrl: 'https://tenant.example/events/event-1',
    expiresAt: 1_900_003_600,
    lineItems: [
      {
        kind: 'registration',
        name: 'Registration',
        quantity: 1,
        taxRateId: 'txr_fixture_zero',
        unitAmount: 1000,
      },
    ],
    notificationEmail: 'attendee@example.org',
  } satisfies Parameters<typeof recoverySessionOwnsClaim>[0]['snapshot'];

  const candidate: Parameters<typeof checkoutRecoveryVersion>[0] = {
    attendeeFirstName: 'Ada',
    attendeeLastName: 'Lovelace',
    claim: {
      amount: 1000,
      appFee: 100,
      comment: null,
      createdAt,
      currency: 'EUR',
      eventId: 'event-1',
      eventRegistrationId: 'registration-1',
      executiveUserId: 'user-1',
      id: 'claim-1',
      manuallyCreated: false,
      method: 'stripe',
      refundOperationKey: null,
      sourceTransactionId: null,
      status: 'pending',
      stripeAccountId: 'acct_owned',
      stripeChargeId: null,
      stripeCheckoutCancellationRequestedAt: null,
      stripeCheckoutIncidentSessionId: null,
      stripeCheckoutReconcileAttempts: 0,
      stripeCheckoutReconcileLastError: null,
      stripeCheckoutReconcileLeaseExpiresAt: null,
      stripeCheckoutReconcileLeaseId: null,
      stripeCheckoutReconcileNextAt: null,
      stripeCheckoutRequest: snapshot,
      stripeCheckoutSessionId: null,
      stripeCheckoutUrl: null,
      stripeFee: null,
      stripeNetAmount: null,
      stripePaymentIntentId: null,
      stripeRefundApplicationFee: null,
      stripeRefundAttempts: 0,
      stripeRefundClaimLeaseExpiresAt: null,
      stripeRefundClaimLeaseId: null,
      stripeRefundGeneration: 0,
      stripeRefundHistory: [],
      stripeRefundId: null,
      stripeRefundLastError: null,
      stripeRefundLastRequeueReason: null,
      stripeRefundMaxAttempts: 8,
      stripeRefundNextAttemptAt: null,
      stripeRefundRequeuedAt: null,
      stripeRefundStatus: null,
      targetUserId: 'user-1',
      tenantId: 'tenant-1',
      type: 'registration',
      updatedAt: createdAt,
    },
    eventTitle: 'City tour',
    registration: {
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      basePriceAtRegistration: 1000,
      checkedInGuestCount: 0,
      checkInTime: null,
      createdAt,
      discountAmount: 0,
      eventId: 'event-1',
      guestCount: 0,
      id: 'registration-1',
      paymentId: null,
      registrationOptionId: 'option-1',
      status: 'PENDING',
      stripeTaxRateId: 'txr_fixture_zero',
      taxRateDisplayName: 'VAT',
      taxRateInclusive: true,
      taxRatePercentage: '0',
      tenantId: 'tenant-1',
      updatedAt: createdAt,
      userId: 'user-1',
    },
    registrationMode: 'fcfs',
    stripeAccountId: 'acct_owned',
  };
  const claim: Parameters<typeof recoverySessionOwnsClaim>[0] = {
    appFee: 100,
    candidate,
    identity: {
      registrationId: 'registration-1',
      tenantId: 'tenant-1',
      transactionId: 'claim-1',
      userId: 'user-1',
    },
    snapshot,
    stripeAccountId: 'acct_owned',
  };
  const session = stripeCheckoutSessionResponse({
    amount_subtotal: 1000,
    amount_total: 1000,
    cancel_url: `${snapshot.eventUrl}?registrationStatus=cancel`,
    created: 1_900_000_000,
    customer_email: snapshot.customerEmail,
    expires_at: snapshot.expiresAt,
    metadata: claim.identity,
    payment_intent: null,
    payment_status: 'unpaid',
    status: 'open',
    success_url: `${snapshot.eventUrl}?registrationStatus=success`,
  });

  it('requires an exact original session and does not treat a matching amount as ownership', () => {
    expect(recoverySessionOwnsClaim(claim, session)).toBe(true);
    for (const overrides of [
      { amount_total: 999 },
      { currency: 'usd' },
      { customer_email: 'other@example.org' },
      { expires_at: snapshot.expiresAt + 1 },
      { success_url: 'https://other.example' },
      { cancel_url: 'https://other.example' },
      { url: 'https://other.example/pay' },
      { metadata: { ...claim.identity, userId: 'other-user' } },
      { metadata: { ...claim.identity, transferId: 'transfer-1' } },
      { created: 1_899_000_000 },
    ])
      expect(
        recoverySessionOwnsClaim(claim, { ...session, ...overrides }),
      ).toBe(false);
  });

  it('checks quantities, item prices and exact inclusive tax identities including zero-percent tax', () => {
    const line = stripeLineItemFixture();
    expect(recoveryLineItemsOwnClaim(claim, [line])).toBe(true);
    const { taxes: _taxes, ...withoutTaxes } = line;
    const { discounts: _discounts, ...withoutDiscounts } = line;
    expect(recoveryLineItemsOwnClaim(claim, [withoutTaxes])).toBe(false);
    expect(recoveryLineItemsOwnClaim(claim, [withoutDiscounts])).toBe(false);
    expect(recoveryLineItemsOwnClaim(claim, [])).toBe(false);
    expect(recoveryLineItemsOwnClaim(claim, [line, line])).toBe(false);
    for (const changed of [
      stripeLineItemFixture({ quantity: 2 }),
      stripeLineItemFixture({ amount_total: 999 }),
      stripeLineItemFixture({ description: 'Other purchase' }),
      stripeLineItemFixture({ amount_discount: 100 }),
      stripeLineItemFixture({ taxes: [] }),
      stripeLineItemFixture({
        taxes: [
          {
            amount: 0,
            rate: stripeTaxRateFixture({ id: 'txr_other' }),
            taxability_reason: null,
            taxable_amount: 1000,
          },
        ],
      }),
      stripeLineItemFixture({
        taxes: [
          {
            amount: 0,
            rate: stripeTaxRateFixture({ inclusive: false }),
            taxability_reason: null,
            taxable_amount: 1000,
          },
        ],
      }),
    ])
      expect(recoveryLineItemsOwnClaim(claim, [changed])).toBe(false);
  });

  it('changes the reviewed version when payment ownership, held registration or approval mode changes', () => {
    const original = checkoutRecoveryVersion(candidate);
    expect(original).toMatch(/^[a-f0-9]{64}$/u);
    for (const changed of [
      { ...candidate, claim: { ...candidate.claim, appFee: 200 } },
      {
        ...candidate,
        claim: {
          ...candidate.claim,
          stripeCheckoutIncidentSessionId: 'cs_other',
        },
      },
      {
        ...candidate,
        registration: { ...candidate.registration, guestCount: 1 },
      },
      { ...candidate, stripeAccountId: 'acct_other' },
    ])
      expect(checkoutRecoveryVersion(changed)).not.toBe(original);
    expect(
      checkoutRecoveryVersion({
        ...candidate,
        registrationMode: 'application',
      }),
    ).not.toBe(original);
  });

  it('validates the target, reviewed version, bounded page and operational reason at the RPC boundary', () => {
    const valid = {
      claimId: 'claim-1',
      expectedVersion: checkoutRecoveryVersion(candidate),
      reason: 'Restore original payment',
      targetTenantId: 'tenant-1',
    };
    expect(
      Schema.decodeUnknownSync(PlatformFinanceRecoverCheckoutInput)(valid),
    ).toEqual(valid);
    for (const invalid of [
      { ...valid, reason: ' ' },
      { ...valid, reason: 'Use acct_private for this' },
      { ...valid, expectedVersion: '' },
      { ...valid, expectedVersion: 'x'.repeat(64) },
      { ...valid, targetTenantId: '' },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(PlatformFinanceRecoverCheckoutInput)(invalid),
      ).toThrow();
    }
    for (const limit of [0, 101])
      expect(() =>
        Schema.decodeUnknownSync(PlatformFinanceCheckoutRecoveryQueueInput)({
          limit,
          offset: 0,
          targetTenantId: 'tenant-1',
        }),
      ).toThrow();
  });
});
