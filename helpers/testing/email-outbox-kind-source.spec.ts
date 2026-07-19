import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../..', import.meta.url).pathname;
const durableEmailKinds = [
  'manualApproval',
  'receiptReviewed',
  'registrationCancelled',
  'registrationConfirmed',
  'registrationTransferred',
  'waitlistSpotAvailable',
] as const;

const readSource = (sourcePath: string): string =>
  readFileSync(path.join(repositoryRoot, sourcePath), 'utf8');

describe('email outbox kind source inventory', () => {
  it('keeps schema, RPC contract, and operator labels aligned', () => {
    const schemaSource = readSource('src/db/schema/email-outbox.ts');
    const contractSource = readSource(
      'src/shared/rpc-contracts/app-rpcs/global-admin.rpcs.ts',
    );
    const componentSource = readSource(
      'src/app/global-admin/email-outbox/email-outbox.component.ts',
    );

    for (const kind of durableEmailKinds) {
      expect(schemaSource).toContain(`'${kind}'`);
      expect(contractSource).toContain(`'${kind}'`);
      expect(componentSource).toContain(`${kind}:`);
    }
    expect(componentSource).toContain(
      'satisfies Record<GlobalAdminEmailOutboxKind, string>',
    );
    expect(schemaSource).not.toContain("'eventCancelled'");
  });

  it('keeps lifecycle producers wired to real transactional transitions and page coverage', () => {
    const deliverySource = readSource(
      'src/server/notifications/email-delivery.ts',
    );
    const templateSource = readSource(
      'src/server/notifications/email-templates.ts',
    );
    const registrationServiceSource = readSource(
      'src/server/effect/rpc/handlers/events/event-registration.service.ts',
    );
    const registrationHandlerSource = readSource(
      'src/server/effect/rpc/handlers/events/events-registration.handlers.ts',
    );
    const stripeWebhookSource = readSource(
      'src/server/http/stripe-webhook.web-handler.ts',
    );
    const checkoutCompletionSource = readSource(
      'src/server/registrations/registration-checkout-completion.ts',
    );
    const pageFlowSource = readSource(
      'tests/specs/events/free-registration.test.ts',
    );
    const generatedGuideSource = readSource(
      'tests/docs/events/register.doc.ts',
    );

    expect(deliverySource).toContain("from '@react-email/render'");
    expect(templateSource).toContain("from '@react-email/components'");
    expect(deliverySource).toContain('enqueueRegistrationConfirmedEmail');
    expect(deliverySource).toContain('enqueueWaitlistSpotAvailableEmail');
    expect(deliverySource).toContain('enqueueRegistrationCancelledEmail');
    expect(deliverySource).toContain('enqueueRegistrationTransferredEmail');
    expect(registrationServiceSource).toContain(
      'yield* enqueueRegistrationConfirmedEmail(tx',
    );
    expect(registrationHandlerSource).toContain(
      'yield* enqueueRegistrationCancelledEmail(tx',
    );
    expect(registrationHandlerSource).toContain(
      'yield* enqueueRegistrationTransferredEmail(tx',
    );
    expect(registrationHandlerSource).toContain(
      'yield* enqueueWaitlistSpotAvailableEmail(tx',
    );
    expect(checkoutCompletionSource).toContain(
      'yield* enqueueRegistrationConfirmedEmail(tx',
    );
    expect(stripeWebhookSource).toContain(
      'yield* completePaidRegistrationCheckout(',
    );
    expect(stripeWebhookSource).not.toContain(
      'enqueueRegistrationConfirmedEmail',
    );
    expect(stripeWebhookSource).toContain(
      'yield* enqueueWaitlistSpotAvailableEmail(tx',
    );
    expect(pageFlowSource).toContain("kind: 'registrationConfirmed'");
    expect(generatedGuideSource).toContain("kind: 'registrationConfirmed'");
  });

  it('keeps the durable kind guard discoverable in the test inventory', () => {
    const inventory = readSource('tests/test-inventory.md');

    expect(inventory).toContain(
      '`helpers/testing/email-outbox-kind-source.spec.ts` keeps the typed kinds,',
    );
    expect(inventory).toContain(
      'operator labels, React Email producers, transactional transition splices,',
    );
    expect(inventory).toContain('and page-backed coverage aligned');
  });
});
