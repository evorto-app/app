import type { TemplateGraphRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import { describe, expect, it } from '@effect/vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  platformTemplateAuditSnapshot,
  platformTemplateIconTenantScope,
} from './platform-templates.handlers';

const graphRecord: TemplateGraphRecord = {
  addOns: [
    {
      allowMultiple: true,
      allowPurchaseBeforeEvent: true,
      allowPurchaseDuringEvent: false,
      allowPurchaseDuringRegistration: true,
      description: 'Not included in audit state',
      id: 'addon-1',
      isPaid: false,
      maxQuantityPerUser: 2,
      price: 0,
      registrationOptions: [
        {
          includedQuantity: 1,
          optionalPurchaseQuantity: 2,
          registrationOptionId: 'option-1',
        },
        {
          includedQuantity: 0,
          optionalPurchaseQuantity: 2,
          registrationOptionId: 'option-2',
        },
      ],
      stripeTaxRateId: null,
      title: 'Shared add-on',
      totalAvailableQuantity: 20,
    },
  ],
  categoryId: 'category-1',
  description: '<p>Template description</p>',
  icon: { iconColor: 0, iconName: 'calendar:fas' },
  id: 'template-1',
  location: null,
  planningTips: null,
  questions: [
    {
      description: 'Not included in audit state',
      id: 'question-1',
      registrationOptionId: 'option-2',
      required: true,
      sortOrder: 0,
      title: 'Question',
    },
  ],
  registrationOptions: [
    {
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationOffset: 24,
      description: null,
      esnCardDiscountedPrice: null,
      id: 'option-1',
      isPaid: false,
      openRegistrationOffset: 168,
      organizingRegistration: true,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'application',
      roleIds: ['role-1'],
      roles: [{ id: 'role-1', name: 'Organizer' }],
      spots: 5,
      stripeTaxRateId: null,
      title: 'Organizers',
      transferDeadlineHoursBeforeStart: null,
    },
    {
      cancellationDeadlineHoursBeforeStart: null,
      closeRegistrationOffset: 12,
      description: null,
      esnCardDiscountedPrice: null,
      id: 'option-2',
      isPaid: false,
      openRegistrationOffset: 240,
      organizingRegistration: false,
      price: 0,
      refundFeesOnCancellation: null,
      registeredDescription: null,
      registrationMode: 'fcfs',
      roleIds: ['role-2'],
      roles: [{ id: 'role-2', name: 'Participant' }],
      spots: 30,
      stripeTaxRateId: null,
      title: 'Participants',
      transferDeadlineHoursBeforeStart: null,
    },
  ],
  simpleModeEnabled: false,
  title: 'Advanced template',
};

describe('platform template full-graph handler', () => {
  it('scopes icon choices to the explicitly targeted organization', () => {
    const query = new PgDialect().sqlToQuery(
      platformTemplateIconTenantScope('tenant-target'),
    );

    expect(query.sql).toBe('"icons"."tenantId" = $1');
    expect(query.params).toEqual(['tenant-target']);
  });

  it('keeps registration options in audit without free-text PII', () => {
    const snapshot = platformTemplateAuditSnapshot(graphRecord);
    const encoded = JSON.stringify(snapshot);

    expect(snapshot.state).toEqual(
      expect.objectContaining({
        addOns: [
          expect.objectContaining({
            registrationOptions: [
              {
                includedQuantity: 1,
                optionalPurchaseQuantity: 2,
                registrationOptionId: 'option-1',
              },
              {
                includedQuantity: 0,
                optionalPurchaseQuantity: 2,
                registrationOptionId: 'option-2',
              },
            ],
          }),
        ],
        simpleModeEnabled: false,
      }),
    );
    expect(encoded).toContain('application');
    expect(encoded).toContain('option-1');
    expect(encoded).toContain('option-2');
    expect(encoded).not.toContain('Not included in audit state');
  });
});
