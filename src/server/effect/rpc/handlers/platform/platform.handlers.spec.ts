import { describe, expect, it } from '@effect/vitest';
import {
  PlatformRegistrationPageLimit,
  PlatformRegistrationsListInput,
} from '@shared/rpc-contracts/app-rpcs/platform-events.rpcs';
import { RpcRequestContext } from '@shared/rpc-contracts/app-rpcs/rpc-request-context.middleware';
import { Effect, Schema } from 'effect';
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';

import { Database, type DatabaseClient } from '../../../../../db';
import { PlatformAdministratorAuthority } from '../../../../../types/custom/platform-authority';
import { Tenant } from '../../../../../types/custom/tenant';
import { RegistrationTransferMutationConflict } from '../../../../registrations/registration-transfer-mutation-guard';
import {
  providePlatformOperation,
  type ResolvedPlatformOperation,
} from '../shared/platform-operation.service';
import { RpcAccess } from '../shared/rpc-access.service';
import {
  platformEventAuditSnapshot,
  platformEventStateError,
  platformUnsupportedRegistrationModeError,
  validatePlatformEventCreateReferences,
} from './platform-events.handlers';
import {
  platformRegistrationActiveTransferError,
  platformRegistrationApprovalAuditSnapshots,
  platformRegistrationAuditSnapshot,
  platformRegistrationCancellationAuditSnapshots,
  platformRegistrationCheckInPlan,
} from './platform-registrations.handlers';
import { platformTemplateAuditSnapshot } from './platform-templates.handlers';
import { platformHandlers } from './platform.handlers';

const eventRecord = {
  addOns: [],
  creator: {
    email: 'owner@example.org',
    firstName: 'Event',
    id: 'user-owner',
    lastName: 'Owner',
  },
  description: '<p>Event description</p>',
  end: '2026-07-10T14:00:00.000Z',
  icon: { iconColor: 0, iconName: 'calendar:fas' },
  id: 'event-1',
  location: null,
  questions: [],
  registrationCount: 1,
  registrationOptions: [
    {
      cancellationDeadlineHoursBeforeStart: null,
      checkedInSpots: 0,
      closeRegistrationTime: '2026-07-09T12:00:00.000Z',
      confirmedSpots: 1,
      description: null,
      esnCardDiscountedPrice: null,
      id: 'option-1',
      isPaid: false,
      openRegistrationTime: '2026-07-01T12:00:00.000Z',
      organizingRegistration: false,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'fcfs' as const,
      roleIds: [],
      spots: 10,
      stripeTaxRateId: null,
      title: 'Participant',
      transferDeadlineHoursBeforeStart: null,
    },
  ],
  reviewedAt: null,
  start: '2026-07-10T12:00:00.000Z',
  status: 'DRAFT' as const,
  statusComment: null,
  title: 'Event',
  unlisted: false,
};

const registrationRecord = {
  allowCheckIn: true,
  attendee: {
    email: 'attendee@example.org',
    firstName: 'Attendee',
    id: 'user-attendee',
    lastName: 'Person',
  },
  attendeeCheckedIn: false,
  cancellation: {
    available: true,
    blockedReason: null,
    deadline: '2026-07-05T12:00:00.000Z',
    deadlinePassed: true,
    refund: {
      amount: null,
      feesIncluded: true,
      method: null,
      required: false,
    },
  },
  checkedInGuestCount: 0,
  checkInTime: null,
  checkInTimingIssue: false,
  event: {
    id: 'event-1',
    start: '2026-07-10T12:00:00.000Z',
    title: 'Event',
  },
  guestCount: 2,
  id: 'registration-1',
  manualApprovalAvailable: false,
  paymentPending: false,
  registrationMode: 'fcfs' as const,
  registrationOptionTitle: 'Participant',
  registrationStatusIssue: false,
  remainingGuestCount: 2,
  status: 'CONFIRMED' as const,
};

const templateRecord = {
  addOns: [],
  categoryId: 'category-1',
  description: '<p>Template description</p>',
  icon: { iconColor: 0, iconName: 'calendar:fas' },
  id: 'template-1',
  location: null,
  planningTips: null,
  questions: [],
  registrationOptions: [
    {
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationOffset: 1,
      description: null,
      esnCardDiscountedPrice: null,
      id: 'template-option-1',
      isPaid: false,
      openRegistrationOffset: 168,
      organizingRegistration: false,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'fcfs' as const,
      roleIds: [],
      roles: [],
      spots: 10,
      stripeTaxRateId: null,
      title: 'Participant',
      transferDeadlineHoursBeforeStart: null,
    },
  ],
  simpleModeEnabled: false,
  title: 'Template',
  unlisted: false,
};

const authority = PlatformAdministratorAuthority.make({
  actorEmail: 'platform@example.org',
  actorId: 'auth0|platform-admin',
  kind: 'platformAdministrator',
});

const targetTenant = Tenant.make({
  cancellationDeadlineHoursBeforeStart: 120,
  canonicalRootUrl: 'https://target.example.org',
  currency: 'EUR',
  defaultLocation: undefined,
  discountProviders: { esnCard: { config: {}, status: 'disabled' } },
  domain: 'target.example.org',
  emailSenderEmail: undefined,
  emailSenderName: undefined,
  faviconUrl: undefined,
  id: 'tenant-target',
  legalNoticeText: undefined,
  legalNoticeUrl: undefined,
  locale: 'de-DE',
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

const operation: ResolvedPlatformOperation = {
  authority,
  reason: 'Correct a target-tenant event state',
  requestContext: {
    authData: { sub: authority.actorId },
    authenticated: true,
    permissions: [],
    platformAuthority: authority,
    tenant: targetTenant,
    user: null,
    userAssigned: false,
  },
  targetTenant,
};

describe('platform event, template, and registration handlers', () => {
  it('exports only explicit platform namespaces', () => {
    expect(Object.keys(platformHandlers).toSorted()).toEqual([
      'platform.events.create',
      'platform.events.findOne',
      'platform.events.formOptions',
      'platform.events.list',
      'platform.events.review',
      'platform.events.submitForReview',
      'platform.events.update',
      'platform.events.updateListing',
      'platform.registrations.approve',
      'platform.registrations.cancel',
      'platform.registrations.checkIn',
      'platform.registrations.findOne',
      'platform.registrations.list',
      'platform.templates.create',
      'platform.templates.findOne',
      'platform.templates.formOptions',
      'platform.templates.list',
      'platform.templates.update',
    ]);
  });

  it.effect('grants only the exact server-selected operation capability', () =>
    providePlatformOperation(
      Effect.gen(function* () {
        yield* RpcAccess.ensurePermission('events:create');
        const denied = yield* RpcAccess.ensurePermission('events:review').pipe(
          Effect.flip,
        );
        expect(denied['_tag']).toBe('RpcForbiddenError');
        const context = yield* RpcAccess.current();
        expect(context.tenant.id).toBe('tenant-target');
        expect(context.user).toBeNull();
      }),
      operation,
      ['events:create'],
    ).pipe(Effect.provide(RpcAccess.Default)),
  );

  it.effect(
    'rejects missing creator membership and cross-tenant templates',
    () =>
      Effect.gen(function* () {
        const creatorError = yield* validatePlatformEventCreateReferences({
          creatorMembershipFound: false,
          registrationModes: [],
          templateFound: true,
        }).pipe(Effect.flip);
        expect(creatorError.reason).toBe('creatorMembershipNotFound');

        const templateError = yield* validatePlatformEventCreateReferences({
          creatorMembershipFound: true,
          registrationModes: [],
          templateFound: false,
        }).pipe(Effect.flip);
        expect(templateError.reason).toBe('templateNotFound');

        const modeError = yield* validatePlatformEventCreateReferences({
          creatorMembershipFound: true,
          registrationModes: ['random'],
          templateFound: true,
        }).pipe(Effect.flip);
        expect(modeError.reason).toBe('unsupportedRegistrationMode');
      }),
  );

  it('reports lifecycle state conflicts before writes', () => {
    expect(
      platformEventStateError(
        'APPROVED',
        'DRAFT',
        'Only draft events can be updated',
      )?.reason,
    ).toBe('eventStateConflict');
    expect(
      platformEventStateError(
        'PENDING_REVIEW',
        'PENDING_REVIEW',
        'Only pending events can be reviewed',
      ),
    ).toBeNull();
  });

  it.effect(
    'rejects random event updates before opening a target mutation',
    () =>
      Effect.gen(function* () {
        expect(
          platformUnsupportedRegistrationModeError(['application', 'fcfs']),
        ).toBeNull();

        const error = yield* platformHandlers['platform.events.update'](
          {
            addOns: eventRecord.addOns,
            description: eventRecord.description,
            end: eventRecord.end,
            eventId: eventRecord.id,
            icon: eventRecord.icon,
            location: eventRecord.location,
            questions: eventRecord.questions,
            reason: 'Attempt to retain an unsupported allocation mode',
            registrationOptions: eventRecord.registrationOptions.map(
              (option) => ({
                ...option,
                registrationMode: 'random',
              }),
            ),
            start: eventRecord.start,
            targetTenantId: targetTenant.id,
            title: eventRecord.title,
          } as never,
          undefined,
        ).pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: 'RpcBadRequestError',
          reason: 'unsupportedRegistrationMode',
        });
      }),
  );

  it.effect('plans attendee and guest counters without double counting', () =>
    Effect.gen(function* () {
      const initial = yield* platformRegistrationCheckInPlan({
        checkedInGuestCount: 0,
        checkInTime: null,
        guestCheckInCount: 1,
        guestCount: 2,
        status: 'CONFIRMED',
      });
      expect(initial).toEqual({
        alreadyCheckedInWithoutMoreGuests: false,
        checkedInSpotCount: 2,
        remainingGuestCount: 2,
      });

      const additionalGuest = yield* platformRegistrationCheckInPlan({
        checkedInGuestCount: 1,
        checkInTime: new Date('2026-07-10T11:30:00.000Z'),
        guestCheckInCount: 1,
        guestCount: 2,
        status: 'CONFIRMED',
      });
      expect(additionalGuest.checkedInSpotCount).toBe(1);

      const statusError = yield* platformRegistrationCheckInPlan({
        checkedInGuestCount: 0,
        checkInTime: null,
        guestCheckInCount: 0,
        guestCount: 0,
        status: 'PENDING',
      }).pipe(Effect.flip);
      expect(statusError.reason).toBe('registrationStateConflict');
    }),
  );

  it.effect('defaults and bounds platform registration result pages', () =>
    Effect.gen(function* () {
      const defaults = yield* Schema.decodeUnknownEffect(
        PlatformRegistrationsListInput,
      )({ targetTenantId: 'tenant-1' });
      expect(defaults.limit).toBe(100);
      expect(defaults.offset).toBe(0);
      const oversized = yield* Schema.decodeUnknownEffect(
        PlatformRegistrationPageLimit,
      )(101).pipe(Effect.flip);
      expect(oversized['_tag']).toBe('SchemaError');
    }),
  );

  it('maps source and recipient active transfers to truthful platform conflicts', () => {
    const source = platformRegistrationActiveTransferError(
      new RegistrationTransferMutationConflict({
        message: 'Active source transfer',
        registrationId: 'registration-source',
        registrationSide: 'source',
        status: 'open',
        transferId: 'transfer-1',
      }),
    );
    const recipient = platformRegistrationActiveTransferError(
      new RegistrationTransferMutationConflict({
        message: 'Active recipient transfer',
        registrationId: 'registration-recipient',
        registrationSide: 'recipient',
        status: 'checkout_pending',
        transferId: 'transfer-2',
      }),
    );

    expect(source.reason).toBe('registrationTransferActive');
    expect(source.message).toContain('source registration');
    expect(source.message).toContain('Finish or cancel');
    expect(recipient.reason).toBe('registrationTransferActive');
    expect(recipient.message).toContain('recipient registration');
    expect(recipient.message).toContain('active transfer workflow');
  });

  it.effect(
    'blocks source and recipient active transfers before opening a check-in transaction',
    () =>
      Effect.gen(function* () {
        for (const transfer of [
          {
            id: 'transfer-source',
            recipientRegistrationId: null,
            sourceRegistrationId: registrationRecord.id,
            status: 'open',
          },
          {
            id: 'transfer-recipient',
            recipientRegistrationId: registrationRecord.id,
            sourceRegistrationId: 'registration-source',
            status: 'checkout_pending',
          },
        ] as const) {
          const transaction = vi.fn(() =>
            Effect.die(new Error('Check-in transaction must not start')),
          );
          const database = {
            query: {
              tenants: {
                findFirst: () => Effect.succeed(targetTenant),
              },
            },
            select: () => ({
              from: () => ({
                where: () => ({
                  for: () => Effect.succeed([transfer]),
                }),
              }),
            }),
            transaction,
          } as unknown as DatabaseClient;

          const error = yield* platformHandlers[
            'platform.registrations.checkIn'
          ](
            {
              guestCheckInCount: 0,
              reason: 'Validate the attendee transfer state before check-in',
              registrationId: registrationRecord.id,
              targetTenantId: targetTenant.id,
            },
            undefined,
          ).pipe(
            Effect.provide(RpcAccess.Default),
            Effect.provideService(RpcRequestContext, operation.requestContext),
            Effect.provideService(Database, database),
            Effect.flip,
          );

          expect(error).toMatchObject({
            _tag: 'RpcBadRequestError',
            reason: 'registrationTransferActive',
          });
          expect(transaction).not.toHaveBeenCalled();
        }
      }),
  );

  it('keeps immutable audit snapshots PII-free and resource typed', () => {
    const eventSnapshot = platformEventAuditSnapshot(eventRecord);
    const registrationSnapshot =
      platformRegistrationAuditSnapshot(registrationRecord);
    const templateSnapshot = platformTemplateAuditSnapshot(templateRecord);

    expect(eventSnapshot.resourceType).toBe('event');
    expect(registrationSnapshot.resourceType).toBe('registration');
    expect(templateSnapshot.resourceType).toBe('template');
    const encoded = JSON.stringify([
      eventSnapshot,
      registrationSnapshot,
      templateSnapshot,
    ]);
    for (const pii of [
      'owner@example.org',
      'attendee@example.org',
      'Event Owner',
      'Attendee Person',
    ]) {
      expect(encoded).not.toContain(pii);
    }
  });

  it('captures approval and cancellation transitions without attendee PII', () => {
    const approval = platformRegistrationApprovalAuditSnapshots({
      eventId: 'event-1',
      guestCount: 2,
      registrationId: 'registration-1',
      registrationOptionId: 'option-1',
      statusAfter: 'CONFIRMED',
      statusBefore: 'PENDING',
      transactionId: null,
      transactionStatus: null,
      userId: 'user-attendee',
    });
    const cancellation = platformRegistrationCancellationAuditSnapshots({
      checkInTime: null,
      eventId: 'event-1',
      guestCount: 2,
      refundTransactionId: 'refund-1',
      refundTransactionStatus: 'pending',
      registrationId: 'registration-1',
      registrationOptionId: 'option-1',
      statusAfter: 'CANCELLED',
      statusBefore: 'CONFIRMED',
      userId: 'user-attendee',
    });

    expect(approval.before.state).toMatchObject({ status: 'PENDING' });
    expect(approval.after.state).toMatchObject({ status: 'CONFIRMED' });
    expect(cancellation.after.state).toMatchObject({
      refundTransactionId: 'refund-1',
      status: 'CANCELLED',
    });
    expect(JSON.stringify([approval, cancellation])).not.toContain(
      'attendee@example.org',
    );
  });

  it('keeps target predicates and audit writes inside mutation transactions', () => {
    const eventSource = readFileSync(
      new URL('platform-events.handlers.ts', import.meta.url),
      'utf8',
    );
    const templateSource = readFileSync(
      new URL('platform-templates.handlers.ts', import.meta.url),
      'utf8',
    );
    const registrationSource = readFileSync(
      new URL('platform-registrations.handlers.ts', import.meta.url),
      'utf8',
    );

    for (const source of [eventSource, templateSource, registrationSource]) {
      expect(source).toContain('database.transaction');
      expect(source).toContain('writePlatformAudit(transaction');
      expect(source).toContain('input.targetTenantId');
    }
    expect(eventSource).toContain(
      'eq(eventInstances.tenantId, targetTenantId)',
    );
    expect(templateSource).toContain(
      'eq(eventTemplates.tenantId, targetTenantId)',
    );
    expect(registrationSource).toContain(
      'eq(eventRegistrations.tenantId, targetTenantId)',
    );
    expect(registrationSource).toContain(
      "cancelledBy: 'platformAdministrator'",
    );
    expect(registrationSource).toContain('enforceParticipantDeadline: false');
    expect(registrationSource).toContain('executiveUserId: null');
    expect(registrationSource).toContain("action: 'registration.approve'");
    expect(registrationSource).toContain("action: 'registration.cancel'");
    expect(registrationSource).toContain(
      'targetTenant: operation.targetTenant',
    );
    const checkInHandler = registrationSource.slice(
      registrationSource.indexOf("'platform.registrations.checkIn'"),
      registrationSource.indexOf("'platform.registrations.findOne'"),
    );
    const transferGuard =
      'ensurePlatformRegistrationMutationHasNoActiveTransfer(';
    expect(checkInHandler.split(transferGuard)).toHaveLength(3);
    const firstGuardIndex = checkInHandler.indexOf(transferGuard);
    const lockedRegistrationIndex = checkInHandler.indexOf(
      'const lockedRegistration',
    );
    const secondGuardIndex = checkInHandler.indexOf(
      transferGuard,
      firstGuardIndex + transferGuard.length,
    );
    expect(firstGuardIndex).toBeLessThan(
      checkInHandler.indexOf('database.transaction'),
    );
    expect(secondGuardIndex).toBeGreaterThan(lockedRegistrationIndex);
    expect(secondGuardIndex).toBeLessThan(
      checkInHandler.indexOf('const before'),
    );

    const createHandler = eventSource.slice(
      eventSource.indexOf("'platform.events.create'"),
      eventSource.indexOf("'platform.events.findOne'"),
    );
    expect(createHandler).not.toContain("isolationLevel: 'repeatable read'");
    expect(createHandler).toContain(
      'lockTenantRoleGraph(\n                transaction,\n                input.targetTenantId,',
    );
    expect(createHandler.indexOf('lockTenantRoleGraph')).toBeLessThan(
      createHandler.indexOf('const creatorMemberships'),
    );
  });
});
