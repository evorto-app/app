import { describe, expect, it } from '@effect/vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

describe('post-registration add-on mutation guards', () => {
  it('keeps caller-controlled clock overrides out of the public purchase service', () => {
    const source = readSource('addon-purchase.service.ts');

    expect(source).not.toContain('pinnedNowIso');
    expect(source).toContain('getServerNow(undefined)');
  });

  it('derives purchase ownership in the RPC handler and forwards only participant intent', () => {
    const source = readSource(
      '../effect/rpc/handlers/events/events-registration.handlers.ts',
    );
    const handlerStart = source.indexOf("'events.purchaseRegistrationAddon':");
    const handlerEnd = source.indexOf(
      "'events.redeemRegistrationAddon':",
      handlerStart,
    );
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(handler).toContain('yield* RpcAccess.ensureAuthenticated()');
    expect(handler).toContain('const { tenant } = yield* RpcAccess.current()');
    expect(handler).toContain('const user = yield* RpcAccess.requireUser()');
    expect(handler).toContain('yield* purchaseRegistrationAddon({');
    expect(handler).toContain('addonId: addOnId');
    expect(handler).toContain('tenantId: tenant.id');
    expect(handler).toContain('userId: user.id');
    expect(handler).not.toContain('pinnedNowIso');
    expect(handler).not.toContain('stripeAccountId');
  });

  it('uses the deterministic registration handler clock for owner add-on availability', () => {
    const source = readSource(
      '../effect/rpc/handlers/events/events-registration.handlers.ts',
    );
    const handlerStart = source.indexOf("'events.getRegistrationStatus':");
    const handlerEnd = source.indexOf("'events.joinWaitlist':", handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(handler).toContain(
      'const now = yield* registrationHandlerNow.pipe(Effect.orDie)',
    );
    expect(handler).not.toContain('getServerNow(undefined)');
  });

  it('blocks registration cancellation while an add-on payment is pending', () => {
    const source = readSource(
      '../effect/rpc/handlers/events/events-registration.handlers.ts',
    );
    const pendingTransaction = source.indexOf(
      'const pendingAddonTransaction =',
    );
    const orderLock = source.indexOf(
      '.from(eventRegistrationAddonPurchaseOrders)',
      pendingTransaction,
    );
    const entitlementLock = source.indexOf(
      'const lockedAddonPurchases =',
      orderLock,
    );

    expect(pendingTransaction).toBeGreaterThanOrEqual(0);
    expect(orderLock).toBeGreaterThan(pendingTransaction);
    expect(entitlementLock).toBeGreaterThan(orderLock);
    expect(source.slice(orderLock, entitlementLock)).toContain(
      ".for('update')",
    );
  });

  it('blocks transfer creation before locking settled add-on entitlements', () => {
    const source = readSource('registration-transfer.service.ts');
    const pendingOrder = source.indexOf('const pendingAddonOrderCandidates =');
    const pendingTransactionLock = source.indexOf(
      'const pendingAddonTransactions =',
      pendingOrder,
    );
    const pendingOrderLock = source.indexOf(
      'const lockedAddonOrders =',
      pendingTransactionLock,
    );
    const completedPaidAddonLock = source.indexOf(
      'const successfulPaidAddonTransactions =',
      pendingOrderLock,
    );
    const entitlementLock = source.indexOf(
      'const sourceAddOnEntitlements =',
      pendingOrderLock,
    );

    expect(pendingOrder).toBeGreaterThanOrEqual(0);
    expect(pendingTransactionLock).toBeGreaterThan(pendingOrder);
    expect(pendingOrderLock).toBeGreaterThan(pendingTransactionLock);
    expect(completedPaidAddonLock).toBeGreaterThan(pendingOrderLock);
    expect(entitlementLock).toBeGreaterThan(completedPaidAddonLock);
    expect(source.slice(completedPaidAddonLock, entitlementLock)).toContain(
      'Registrations with a paid add-on cannot be transferred',
    );
  });

  it('blocks direct ownership transfer before changing the registration user', () => {
    const source = readSource(
      '../effect/rpc/handlers/events/events-registration.handlers.ts',
    );
    const directTransfer = source.indexOf('const transferResult =');
    const pendingOrder = source.indexOf(
      'const pendingAddonOrderCandidates =',
      directTransfer,
    );
    const pendingTransactionLock = source.indexOf(
      'const pendingAddonTransactions =',
      pendingOrder,
    );
    const pendingOrderLock = source.indexOf(
      'const lockedAddonOrders =',
      pendingTransactionLock,
    );
    const completedPaidAddonLock = source.indexOf(
      'const successfulPaidAddonTransactions =',
      pendingOrderLock,
    );
    const ownerUpdate = source.indexOf(
      '.set({\n                userId:',
      pendingOrderLock,
    );

    expect(directTransfer).toBeGreaterThanOrEqual(0);
    expect(pendingOrder).toBeGreaterThan(directTransfer);
    expect(pendingTransactionLock).toBeGreaterThan(pendingOrder);
    expect(pendingOrderLock).toBeGreaterThan(pendingTransactionLock);
    expect(completedPaidAddonLock).toBeGreaterThan(pendingOrderLock);
    expect(ownerUpdate).toBeGreaterThan(completedPaidAddonLock);
    expect(source.slice(completedPaidAddonLock, ownerUpdate)).toContain(
      'Registrations with a paid add-on cannot be transferred',
    );
  });

  it('includes completed paid add-ons in direct-transfer preflight validation', () => {
    const source = readSource(
      '../effect/rpc/handlers/events/events-registration.handlers.ts',
    );

    expect(source).toContain(
      "transaction.type === 'registration' || transaction.type === 'addon'",
    );
    expect(source).toContain(
      'Registrations with a paid registration or paid add-on cannot be transferred',
    );
  });
});
