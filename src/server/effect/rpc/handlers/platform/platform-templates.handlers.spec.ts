import type { TemplateGraphRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import { describe, expect, it } from '@effect/vitest';
import { readFileSync } from 'node:fs';

import { platformTemplateAuditSnapshot } from './platform-templates.handlers';

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
        { quantity: 1, registrationOptionId: 'option-1' },
        { quantity: 2, registrationOptionId: 'option-2' },
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
      registrationMode: 'random',
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
  unlisted: true,
};

describe('platform template full-graph handler', () => {
  it('keeps create, update, and immutable audit writes in one transaction', () => {
    const source = readFileSync(
      new URL('platform-templates.handlers.ts', import.meta.url),
      'utf8',
    );

    expect(source).toContain('database.transaction');
    expect(source).toContain(
      'lockTenantCurrencyForFinancialConfiguration(\n                transaction,\n                targetTenantId,\n                operation.targetTenant.currency,\n              )',
    );
    expect(
      source.indexOf('yield* lockTenantCurrencyForFinancialConfiguration'),
    ).toBeLessThan(
      source.indexOf('yield* TemplateGraphService.createTemplate'),
    );
    expect(source).toContain('TemplateGraphService.createTemplate');
    expect(source).toContain('TemplateGraphService.updateTemplate');
    expect(source).toContain('writePlatformAudit(transaction');
    expect(source).not.toContain('SimpleTemplateService');
    expect(source).not.toContain('eq(eventTemplates.simpleModeEnabled, true)');

    const serviceSource = readFileSync(
      new URL('../templates/template-graph.service.ts', import.meta.url),
      'utf8',
    );
    expect(serviceSource).toContain(
      'eq(eventTemplateCategories.tenantId, tenantId)',
    );
    expect(serviceSource).toContain(
      'tenantRoleIdsExist(database, tenantId, roleIds)',
    );
    expect(serviceSource).toContain('stripeTaxRateId: option.stripeTaxRateId');
    expect(serviceSource).toContain('tenantId,');

    const contractSource = readFileSync(
      new URL(
        '../../../../../shared/rpc-contracts/app-rpcs/templates.rpcs.ts',
        import.meta.url,
      ),
      'utf8',
    );
    expect(contractSource).toMatch(
      /TemplateGraphRegistrationOptionInput[\s\S]*?registrationMode: TemplateWritableRegistrationMode/,
    );
  });

  it('keeps legacy random options readable in audit without free-text PII', () => {
    const snapshot = platformTemplateAuditSnapshot(graphRecord);
    const encoded = JSON.stringify(snapshot);

    expect(snapshot.state).toEqual(
      expect.objectContaining({
        simpleModeEnabled: false,
        unlisted: true,
      }),
    );
    expect(encoded).toContain('random');
    expect(encoded).toContain('option-1');
    expect(encoded).toContain('option-2');
    expect(encoded).not.toContain('Not included in audit state');
  });
});
