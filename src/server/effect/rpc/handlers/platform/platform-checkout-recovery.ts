import { Database, type DatabaseClient } from '@db/index';
import {
  eventInstances,
  eventRegistrationOptions,
  eventRegistrations,
  RegistrationCheckoutSnapshotSchema,
  registrationTransfers,
  tenants,
  transactions,
  users,
} from '@db/schema';
import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import {
  PlatformFinanceCheckoutRecoveryClaim,
  type PlatformFinanceCheckoutRecoveryQueueInput,
  type PlatformFinanceRecoverCheckoutInput,
  PlatformFinanceRecoveredCheckoutState,
} from '@shared/rpc-contracts/app-rpcs/platform-tenant-finance.rpcs';
import { stripeCheckoutUrlMatchesSession } from '@shared/stripe-checkout-url';
import { and, asc, count, eq, gt, isNull, sql } from 'drizzle-orm';
import { Effect, Schema } from 'effect';
import { createHash } from 'node:crypto';
import Stripe from 'stripe';

import { enqueueManualApprovalEmail } from '../../../../notifications/email-delivery';
import { registrationCheckoutInitialReconcileAt } from '../../../../registrations/registration-checkout-completion';
import { directRegistrationCheckoutMetadataOwnsIdentity } from '../../../../registrations/registration-checkout-metadata';
import { StripeClient } from '../../../../stripe-client';
import {
  providePlatformOperation,
  resolvePlatformMutation,
  resolvePlatformRead,
  writePlatformAudit,
} from '../shared/platform-operation.service';
import { RpcAccess } from '../shared/rpc-access.service';

const recoveryError = (reason: string, message: string) =>
  new RpcBadRequestError({ message, reason });
const changedClaim = () =>
  recoveryError(
    'checkoutRecoveryChanged',
    'This payment setup changed. Nothing was restored. Reload the finance information and review it again.',
  );
const unverifiableSession = () =>
  recoveryError(
    'checkoutRecoveryUnverifiable',
    'The existing payment could not be verified against this sign-up. Its reservation remains held for investigation.',
  );

const recoveryPredicate = (targetTenantId: string) =>
  and(
    eq(transactions.tenantId, targetTenantId),
    eq(transactions.method, 'stripe'),
    eq(transactions.type, 'registration'),
    eq(transactions.status, 'pending'),
    gt(transactions.amount, 0),
    isNull(transactions.stripeCheckoutSessionId),
    isNull(transactions.stripeCheckoutUrl),
    isNull(transactions.stripeCheckoutCancellationRequestedAt),
    sql<boolean>`exists (
      select 1 from ${eventRegistrations}
      where ${eventRegistrations.id} = ${transactions.eventRegistrationId}
        and ${eventRegistrations.tenantId} = ${transactions.tenantId}
        and ${eventRegistrations.eventId} = ${transactions.eventId}
        and ${eventRegistrations.userId} = ${transactions.targetUserId}
        and ${eventRegistrations.status} = 'PENDING'
    )`,
    sql<boolean>`not exists (
      select 1 from ${registrationTransfers}
      where ${registrationTransfers.recipientCheckoutTransactionId} = ${transactions.id}
    )`,
  );

const recoveryQuery = (
  database: Pick<DatabaseClient, 'select'>,
  targetTenantId: string,
  claimId?: string,
) =>
  database
    .select({
      attendeeFirstName: users.firstName,
      attendeeLastName: users.lastName,
      claim: transactions,
      eventTitle: eventInstances.title,
      registration: eventRegistrations,
      registrationMode: eventRegistrationOptions.registrationMode,
      stripeAccountId: tenants.stripeAccountId,
    })
    .from(transactions)
    .innerJoin(
      eventRegistrations,
      eq(eventRegistrations.id, transactions.eventRegistrationId),
    )
    .innerJoin(eventInstances, eq(eventInstances.id, transactions.eventId))
    .innerJoin(
      eventRegistrationOptions,
      eq(eventRegistrationOptions.id, eventRegistrations.registrationOptionId),
    )
    .innerJoin(tenants, eq(tenants.id, transactions.tenantId))
    .innerJoin(users, eq(users.id, transactions.targetUserId))
    .where(
      and(
        recoveryPredicate(targetTenantId),
        claimId ? eq(transactions.id, claimId) : undefined,
      ),
    );

type RecoveryCandidate = Effect.Success<
  ReturnType<typeof recoveryQuery>
>[number];

export const checkoutRecoveryVersion = (candidate: RecoveryCandidate) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        claim: candidate.claim,
        registration: candidate.registration,
        registrationMode: candidate.registrationMode,
        stripeAccountId: candidate.stripeAccountId,
      }),
    )
    .digest('hex');

const loadCandidate = Effect.fn('PlatformCheckoutRecovery.loadCandidate')(
  function* (input: PlatformFinanceRecoverCheckoutInput) {
    const candidates = yield* Database.use((database) =>
      recoveryQuery(database, input.targetTenantId, input.claimId).pipe(
        Effect.orDie,
      ),
    );
    const candidate = candidates[0];
    if (
      !candidate ||
      checkoutRecoveryVersion(candidate) !== input.expectedVersion
    ) {
      return yield* changedClaim();
    }
    const claim = candidate.claim;
    if (
      !claim.stripeAccountId ||
      claim.stripeAccountId !== candidate.stripeAccountId ||
      claim.appFee === null ||
      !Number.isSafeInteger(claim.appFee) ||
      claim.appFee < 0 ||
      claim.appFee > claim.amount ||
      !claim.eventId ||
      !claim.eventRegistrationId ||
      !claim.targetUserId
    )
      return yield* unverifiableSession();
    const snapshot = yield* Schema.decodeUnknownEffect(
      RegistrationCheckoutSnapshotSchema,
    )(claim.stripeCheckoutRequest).pipe(
      Effect.mapError(() => unverifiableSession()),
    );
    if (
      !Number.isSafeInteger(snapshot.expiresAt) ||
      snapshot.lineItems.length === 0 ||
      snapshot.lineItems.some(
        (line) =>
          !Number.isSafeInteger(line.quantity) ||
          line.quantity <= 0 ||
          !Number.isSafeInteger(line.unitAmount) ||
          line.unitAmount < 0 ||
          !line.name.trim(),
      ) ||
      snapshot.lineItems.reduce(
        (sum, line) => sum + line.unitAmount * line.quantity,
        0,
      ) !== claim.amount
    )
      return yield* unverifiableSession();
    return {
      appFee: claim.appFee,
      candidate,
      identity: {
        registrationId: claim.eventRegistrationId,
        tenantId: claim.tenantId,
        transactionId: claim.id,
        userId: claim.targetUserId,
      },
      snapshot,
      stripeAccountId: claim.stripeAccountId,
    };
  },
);

type RecoveryClaim = Effect.Success<ReturnType<typeof loadCandidate>>;

const readStripe = <A>(claimId: string, read: () => PromiseLike<A>) =>
  Effect.tryPromise({ catch: (cause) => cause, try: read }).pipe(
    Effect.catch((error) => {
      if (!(error instanceof Stripe.errors.StripeError))
        return Effect.die(error);
      return Effect.logWarning('Checkout recovery provider read failed').pipe(
        Effect.annotateLogs({
          claimId,
          code: error.code ?? null,
          statusCode: error.statusCode ?? null,
        }),
        Effect.andThen(
          Effect.fail(
            recoveryError(
              'checkoutRecoveryProviderUnavailable',
              'The payment provider could not be checked. Nothing was restored and the reservation remains held. Try the check again later.',
            ),
          ),
        ),
      );
    }),
  );

const findSessionId = Effect.fn('PlatformCheckoutRecovery.findSessionId')(
  function* (claim: RecoveryClaim) {
    const knownSession = claim.candidate.claim.stripeCheckoutIncidentSessionId;
    if (knownSession) return knownSession;
    const stripe = yield* StripeClient;
    let startingAfter: string | undefined;
    const matches = new Set<string>();
    const seen = new Set<string>();
    for (let pageNumber = 0; pageNumber < 3; pageNumber += 1) {
      const page = yield* readStripe(claim.identity.transactionId, () =>
        stripe.checkout.sessions.list(
          {
            created: {
              gte:
                Math.floor(claim.candidate.claim.createdAt.getTime() / 1000) -
                300,
              lte: claim.snapshot.expiresAt,
            },
            limit: 100,
            ...(startingAfter && { starting_after: startingAfter }),
          },
          { stripeAccount: claim.stripeAccountId },
        ),
      );
      for (const session of page.data) {
        if (!session.id || seen.has(session.id))
          return yield* unverifiableSession();
        seen.add(session.id);
        if (
          session.metadata?.['transactionId'] === claim.identity.transactionId
        )
          matches.add(session.id);
      }
      if (matches.size > 1)
        return yield* recoveryError(
          'checkoutRecoveryAmbiguous',
          'More than one payment page refers to this sign-up. Nothing was restored; investigate the payment records.',
        );
      if (!page.has_more) {
        const sessionId = [...matches][0];
        if (!sessionId)
          return yield* recoveryError(
            'checkoutRecoveryNotFound',
            'No matching payment page was found. This does not prove that no payment exists. The reservation remains held for investigation.',
          );
        return sessionId;
      }
      const last = page.data.at(-1)?.id;
      if (!last) return yield* unverifiableSession();
      startingAfter = last;
    }
    return yield* recoveryError(
      'checkoutRecoverySearchIncomplete',
      'The payment search could not be completed within this check. Nothing was restored and the reservation remains held for investigation.',
    );
  },
);

export const recoverySessionOwnsClaim = (
  claim: RecoveryClaim,
  session: Stripe.Checkout.Session,
) => {
  const state = session.status;
  return (
    session.object === 'checkout.session' &&
    session.mode === 'payment' &&
    (state === 'open' || state === 'complete' || state === 'expired') &&
    (state === 'complete'
      ? session.payment_status === 'paid' || session.payment_status === 'unpaid'
      : session.payment_status === 'unpaid') &&
    session.amount_total === claim.candidate.claim.amount &&
    session.currency === claim.candidate.claim.currency.toLowerCase() &&
    session.expires_at === claim.snapshot.expiresAt &&
    session.created >=
      Math.floor(claim.candidate.claim.createdAt.getTime() / 1000) - 300 &&
    session.created <= claim.snapshot.expiresAt &&
    session.customer_email === claim.snapshot.customerEmail &&
    session.success_url ===
      `${claim.snapshot.eventUrl}?registrationStatus=success` &&
    session.cancel_url ===
      `${claim.snapshot.eventUrl}?registrationStatus=cancel` &&
    directRegistrationCheckoutMetadataOwnsIdentity({
      identity: claim.identity,
      metadata: session.metadata,
    }) &&
    (state !== 'open' ||
      (typeof session.url === 'string' &&
        stripeCheckoutUrlMatchesSession(session.url, session.id)))
  );
};

export const recoveryLineItemsOwnClaim = (
  claim: RecoveryClaim,
  lines: readonly Stripe.LineItem[],
) => {
  const expected = claim.snapshot.lineItems
    .map((line) =>
      JSON.stringify([
        line.name,
        line.unitAmount,
        line.quantity,
        line.taxRateId ? [line.taxRateId] : [],
      ]),
    )
    .toSorted();
  const actual: string[] = [];
  for (const line of lines) {
    if (
      line.object !== 'item' ||
      line.currency !== claim.candidate.claim.currency.toLowerCase() ||
      line.price?.currency !== line.currency ||
      line.price.type !== 'one_time' ||
      line.price.unit_amount === null ||
      !Number.isSafeInteger(line.price.unit_amount) ||
      line.quantity === null ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0 ||
      line.amount_total !== line.price.unit_amount * line.quantity ||
      line.amount_discount !== 0 ||
      (line.discounts?.length ?? 0) !== 0 ||
      line.taxes?.some((tax) => !tax.rate.inclusive)
    )
      return false;
    actual.push(
      JSON.stringify([
        line.description,
        line.price.unit_amount,
        line.quantity,
        (line.taxes ?? []).map((tax) => tax.rate.id).toSorted(),
      ]),
    );
  }
  return JSON.stringify(actual.toSorted()) === JSON.stringify(expected);
};

const verifyExistingSession = Effect.fn(
  'PlatformCheckoutRecovery.verifyExistingSession',
)(function* (claim: RecoveryClaim) {
  const stripe = yield* StripeClient;
  const sessionId = yield* findSessionId(claim);
  const session = yield* readStripe(claim.identity.transactionId, () =>
    stripe.checkout.sessions.retrieve(sessionId, undefined, {
      stripeAccount: claim.stripeAccountId,
    }),
  );
  if (session.id !== sessionId || !recoverySessionOwnsClaim(claim, session))
    return yield* unverifiableSession();
  const lines = yield* readStripe(claim.identity.transactionId, () =>
    stripe.checkout.sessions.listLineItems(
      sessionId,
      { limit: 100 },
      { stripeAccount: claim.stripeAccountId },
    ),
  );
  if (lines.has_more || !recoveryLineItemsOwnClaim(claim, lines.data))
    return yield* unverifiableSession();
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;
  // Open Checkout can have no PaymentIntent and exposes no application fee.
  // Keep the persisted fee unchanged; normal settlement still verifies it.
  if (paymentIntentId) {
    const payment = yield* readStripe(claim.identity.transactionId, () =>
      stripe.paymentIntents.retrieve(paymentIntentId, undefined, {
        stripeAccount: claim.stripeAccountId,
      }),
    );
    if (
      payment.id !== paymentIntentId ||
      payment.amount !== claim.candidate.claim.amount ||
      payment.currency !== claim.candidate.claim.currency.toLowerCase() ||
      payment.application_fee_amount !== claim.appFee ||
      (session.payment_status === 'paid') !== (payment.status === 'succeeded')
    )
      return yield* unverifiableSession();
  } else if (
    session.payment_status === 'paid' ||
    session.status === 'complete'
  ) {
    return yield* unverifiableSession();
  }
  if (
    session.status !== 'open' &&
    session.status !== 'complete' &&
    session.status !== 'expired'
  )
    return yield* unverifiableSession();
  const sessionState = yield* Schema.decodeUnknownEffect(
    PlatformFinanceRecoveredCheckoutState,
  )(session.status).pipe(Effect.mapError(() => unverifiableSession()));
  return {
    sessionId,
    sessionState,
    url: session.status === 'open' ? session.url : null,
  };
});

export const checkoutRecoveryQueue = Effect.fn(
  'PlatformCheckoutRecovery.queue',
)(function* (input: PlatformFinanceCheckoutRecoveryQueueInput) {
  const operation = yield* resolvePlatformRead(input.targetTenantId);
  return yield* providePlatformOperation(
    Effect.gen(function* () {
      yield* RpcAccess.ensurePermission('finance:viewTransactions');
      const database = yield* Database;
      const [rows, totals] = yield* Effect.all([
        recoveryQuery(database, input.targetTenantId)
          .orderBy(asc(transactions.createdAt), asc(transactions.id))
          .limit(input.limit)
          .offset(input.offset),
        database
          .select({ total: count() })
          .from(transactions)
          .where(recoveryPredicate(input.targetTenantId)),
      ]).pipe(Effect.orDie);
      return {
        data: rows.map((candidate) =>
          PlatformFinanceCheckoutRecoveryClaim.make({
            amount: candidate.claim.amount,
            attendeeFirstName: candidate.attendeeFirstName,
            attendeeLastName: candidate.attendeeLastName,
            createdAt: candidate.claim.createdAt.toISOString(),
            currency: candidate.claim.currency,
            eventTitle: candidate.eventTitle,
            id: candidate.claim.id,
            version: checkoutRecoveryVersion(candidate),
          }),
        ),
        targetTenantId: input.targetTenantId,
        timezone: operation.targetTenant.timezone,
        total: totals[0]?.total ?? 0,
      };
    }),
    operation,
    ['finance:viewTransactions'],
  );
});

export const recoverCheckout = Effect.fn('PlatformCheckoutRecovery.recover')(
  function* (input: PlatformFinanceRecoverCheckoutInput) {
    const operation = yield* resolvePlatformMutation(input);
    return yield* providePlatformOperation(
      Effect.gen(function* () {
        yield* RpcAccess.ensurePermission('events:organizeAll');
        const claim = yield* loadCandidate(input);
        const session = yield* verifyExistingSession(claim);
        const database = yield* Database;
        return yield* database
          .transaction((transaction) =>
            Effect.gen(function* () {
              yield* transaction
                .select({ id: eventRegistrations.id })
                .from(eventRegistrations)
                .where(
                  and(
                    eq(eventRegistrations.id, claim.identity.registrationId),
                    eq(eventRegistrations.tenantId, input.targetTenantId),
                  ),
                )
                .for('update');
              const [tenant] = yield* transaction
                .select()
                .from(tenants)
                .where(eq(tenants.id, input.targetTenantId))
                .for('key share');
              if (!tenant || tenant.stripeAccountId !== claim.stripeAccountId)
                return yield* changedClaim();
              yield* transaction
                .select({ id: eventRegistrationOptions.id })
                .from(eventRegistrationOptions)
                .where(
                  eq(
                    eventRegistrationOptions.id,
                    claim.candidate.registration.registrationOptionId,
                  ),
                )
                .for('share');
              yield* transaction
                .select({ id: transactions.id })
                .from(transactions)
                .where(
                  and(
                    eq(transactions.id, input.claimId),
                    eq(transactions.tenantId, input.targetTenantId),
                  ),
                )
                .for('update');
              const [current] = yield* recoveryQuery(
                transaction,
                input.targetTenantId,
                input.claimId,
              );
              if (
                !current ||
                checkoutRecoveryVersion(current) !== input.expectedVersion
              )
                return yield* changedClaim();
              const updated = yield* transaction
                .update(transactions)
                .set({
                  stripeCheckoutIncidentSessionId: null,
                  stripeCheckoutReconcileAttempts: 0,
                  stripeCheckoutReconcileLastError: null,
                  stripeCheckoutReconcileLeaseExpiresAt: null,
                  stripeCheckoutReconcileLeaseId: null,
                  stripeCheckoutReconcileNextAt:
                    registrationCheckoutInitialReconcileAt(),
                  stripeCheckoutSessionId: session.sessionId,
                  stripeCheckoutUrl: session.url,
                })
                .where(
                  and(
                    eq(transactions.id, input.claimId),
                    recoveryPredicate(input.targetTenantId),
                  ),
                )
                .returning({ id: transactions.id });
              if (updated.length !== 1) return yield* changedClaim();
              if (
                current.registrationMode === 'application' &&
                session.sessionState === 'open'
              ) {
                yield* enqueueManualApprovalEmail(transaction, {
                  approvalKey: current.claim.id,
                  eventTitle: claim.snapshot.eventTitle,
                  eventUrl: claim.snapshot.eventUrl,
                  paymentDeadline: new Date(claim.snapshot.expiresAt * 1000),
                  registrationId: current.registration.id,
                  tenant,
                  to: claim.snapshot.notificationEmail,
                });
              }
              const auditState = {
                amount: current.claim.amount,
                appFee: current.claim.appFee,
                currency: current.claim.currency,
                registrationId: current.registration.id,
                requestDigest: createHash('sha256')
                  .update(JSON.stringify(current.claim.stripeCheckoutRequest))
                  .digest('hex'),
                status: current.claim.status,
                stripeAccountId: claim.stripeAccountId,
                transactionId: current.claim.id,
              };
              yield* writePlatformAudit(transaction, {
                action: 'registration.recoverCheckout',
                after: {
                  resourceId: current.registration.id,
                  resourceType: 'registration',
                  state: {
                    ...auditState,
                    incidentSessionId: null,
                    sessionId: session.sessionId,
                    sessionState: session.sessionState,
                  },
                },
                before: {
                  resourceId: current.registration.id,
                  resourceType: 'registration',
                  state: {
                    ...auditState,
                    incidentSessionId:
                      current.claim.stripeCheckoutIncidentSessionId,
                    lastError: current.claim.stripeCheckoutReconcileLastError,
                    sessionId: null,
                  },
                },
              });
              return {
                claimId: input.claimId,
                sessionState: session.sessionState,
              };
            }),
          )
          .pipe(
            Effect.catch((error) =>
              error instanceof RpcBadRequestError
                ? Effect.fail(error)
                : Effect.die(error),
            ),
          );
      }),
      operation,
      ['events:organizeAll'],
    );
  },
);
