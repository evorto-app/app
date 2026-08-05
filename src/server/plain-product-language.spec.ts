import { render } from '@react-email/render';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import type { RegistrationCancellationKind } from '../shared/registration-cancellation';

import { unknownTenantDocument } from './http/unknown-tenant-response';
import {
  ManualApprovalEmail,
  ReceiptReviewedEmail,
  type RegistrationCancellationActor,
  RegistrationCancelledEmail,
  RegistrationConfirmedEmail,
  RegistrationTransferredEmail,
  WaitlistSpotAvailableEmail,
} from './notifications/email-templates';

const serverRoot = path.join(process.cwd(), 'src/server');
const hostedCheckoutSources = [
  path.join(
    serverRoot,
    'effect/rpc/handlers/events/event-registration.service.ts',
  ),
  path.join(serverRoot, 'registrations/addon-purchase.service.ts'),
  path.join(serverRoot, 'registrations/registration-transfer.service.ts'),
];

const productionSources = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(entryPath);
    return entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts')
      ? [entryPath]
      : [];
  });

const browserMechanicsAndVaguePromises =
  /\b(?:refresh (?:and|before|it|the|this|your)|reload(?: the| this| your)?|temporary problem|temporarily unavailable|try again later)\b|(?<!select )\brefresh to\b/giu;

const userVisibleTechnicalLanguage =
  /\b(?:apis?|authentication|databases?|domains?|eligibility|eligible|endpoints?|fallbacks?|metadata|participants?|payloads?|providers?|register(?:ed|ing|s)?|registrations?|rpcs?|schemas?|stripe|tenants?|transactions?|transactional|webhooks?)\b|platform administrator|queued for refund|source of truth/giu;

const publicErrorTechnicalLanguage =
  /\b(?:apis?|authentication|browser|databases?|endpoints?|fallbacks?|metadata|participants?|payloads?|providers?|refresh(?:ed|es|ing)?|register(?:ed|ing|s)?|registrations?|rpcs?|schemas?|stripe|tenants?|webhooks?)\b|forbidden|internal server error|platform administrator|source of truth|stable identifier/giu;

const publicDocumentText = (document: string): string =>
  document
    .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/giu, ' ')
    .replaceAll(/<[^>]+>/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();

const staticAuthoredText = (initializer: ts.Expression): string | undefined => {
  if (ts.isStringLiteralLike(initializer)) return initializer.text;
  if (ts.isTemplateExpression(initializer)) {
    return [
      initializer.head.text,
      ...initializer.templateSpans.map(({ literal }) => literal.text),
    ].join(' ');
  }
  if (ts.isConditionalExpression(initializer)) {
    return [initializer.whenTrue, initializer.whenFalse]
      .flatMap((branch) => {
        const text = staticAuthoredText(branch);
        return text === undefined ? [] : [text];
      })
      .join(' ');
  }
  return;
};

const authoredPropertyCopy = (
  sourcePath: string,
  propertyName: string,
): { line: number; text: string }[] => {
  const source = readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const comments: { line: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) && node.name.text === propertyName) ||
        (ts.isStringLiteralLike(node.name) && node.name.text === propertyName))
    ) {
      const initializer = node.initializer;
      const text = staticAuthoredText(initializer);
      if (text !== undefined) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          initializer.getStart(sourceFile),
        );
        comments.push({ line: line + 1, text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return comments;
};

const authoredPublicRpcErrorCopy = (
  sourcePath: string,
): { line: number; text: string }[] => {
  const source = readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const copy: { line: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      [
        'failEventRegistrationInternalError',
        'failRegistrationInternalError',
        'failRegistrationTransferInternalError',
        'mapEventRegistrationInternalError',
        'mapRegistrationInternalError',
        'mapRegistrationTransferInternalError',
      ].includes(node.expression.text)
    ) {
      const message = node.arguments[1];
      if (message) {
        const text = staticAuthoredText(message);
        if (text !== undefined) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            message.getStart(sourceFile),
          );
          copy.push({ line: line + 1, text });
        }
      }
    }
    if (ts.isNewExpression(node)) {
      const errorName = node.expression.getText(sourceFile);
      const input = node.arguments?.[0];
      const belongsToRpcBoundary =
        errorName.includes('Rpc') ||
        /^(?:EventRegistration|ReceiptMedia|RegistrationTransfer)/u.test(
          errorName,
        ) ||
        sourcePath.includes(
          `${path.sep}effect${path.sep}rpc${path.sep}handlers`,
        );
      if (
        belongsToRpcBoundary &&
        errorName.endsWith('Error') &&
        input &&
        ts.isObjectLiteralExpression(input)
      ) {
        for (const property of input.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const propertyName =
            ts.isIdentifier(property.name) ||
            ts.isStringLiteralLike(property.name)
              ? property.name.text
              : undefined;
          if (propertyName !== 'message') continue;

          const text = staticAuthoredText(property.initializer);
          if (text !== undefined) {
            const { line } = sourceFile.getLineAndCharacterOfPosition(
              property.initializer.getStart(sourceFile),
            );
            copy.push({ line: line + 1, text });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return copy;
};

const emailExamples = () => [
  ...[null, 'Friday at 18:00'].map((paymentDeadlineText) =>
    ManualApprovalEmail({
      eventTitle: 'City tour',
      eventUrl: 'https://example.org/events/event-1',
      paymentDeadlineText,
      tenantName: 'Example Section',
    }),
  ),
  ...(['approved', 'rejected'] as const).map((status) =>
    ReceiptReviewedEmail({
      eventTitle: 'City tour',
      receiptUrl: 'https://example.org/profile/receipts',
      rejectionReason:
        status === 'rejected' ? 'The total is not readable.' : null,
      status,
      tenantName: 'Example Section',
    }),
  ),
  RegistrationConfirmedEmail({
    eventTitle: 'City tour',
    tenantName: 'Example Section',
    ticketUrl: 'https://example.org/events/event-1',
  }),
  ...(
    [
      'application',
      'pendingSignUp',
      'ticket',
      'waitlist',
    ] as const satisfies readonly RegistrationCancellationKind[]
  ).flatMap((cancellationKind) =>
    (
      [
        'organizer',
        'participant',
        'platformAdministrator',
      ] as const satisfies readonly RegistrationCancellationActor[]
    ).flatMap((cancelledBy) =>
      (['notStarted', 'pending'] as const).map((refundOutcome) =>
        RegistrationCancelledEmail({
          cancellationKind,
          cancelledBy,
          eventTitle: 'City tour',
          eventUrl: 'https://example.org/events/event-1',
          refundOutcome,
          tenantName: 'Example Section',
        }),
      ),
    ),
  ),
  ...(['notStarted', 'pending'] as const).map((refundOutcome) =>
    RegistrationCancelledEmail({
      cancellationKind: 'pendingSignUp',
      cancelledBy: 'eligibilityChangedAfterPayment',
      eventTitle: 'City tour',
      eventUrl: 'https://example.org/events/event-1',
      refundOutcome,
      tenantName: 'Example Section',
    }),
  ),
  ...(['newOwner', 'previousOwner'] as const).flatMap((recipientRole) =>
    (['notStarted', 'pending'] as const).map((refundOutcome) =>
      RegistrationTransferredEmail({
        eventTitle: 'City tour',
        eventUrl: 'https://example.org/events/event-1',
        recipientRole,
        refundOutcome,
        tenantName: 'Example Section',
      }),
    ),
  ),
  WaitlistSpotAvailableEmail({
    eventTitle: 'City tour',
    eventUrl: 'https://example.org/events/event-1',
    tenantName: 'Example Section',
  }),
];

describe('plain server-supplied product language', () => {
  it('does not ask users to repair stale state through browser mechanics', () => {
    const violations = productionSources(serverRoot).flatMap((sourcePath) =>
      [
        ...readFileSync(sourcePath, 'utf8').matchAll(
          browserMechanicsAndVaguePromises,
        ),
      ].map(
        (match) => `${path.relative(process.cwd(), sourcePath)}: ${match[0]}`,
      ),
    );

    expect(violations).toEqual([]);
  });

  it('keeps every rendered email variant in product language', async () => {
    const messages = await Promise.all(
      emailExamples().map((email) => render(email, { plainText: true })),
    );
    const violations = messages.flatMap((message, index) =>
      [...message.matchAll(userVisibleTechnicalLanguage)].map(
        (match) => `email ${index + 1}: ${match[0]}`,
      ),
    );

    expect(violations).toEqual([]);
  });

  it('keeps the standalone public error page in product language', () => {
    const violations = [
      ...publicDocumentText(unknownTenantDocument).matchAll(
        userVisibleTechnicalLanguage,
      ),
    ].map((match) => match[0]);

    expect(violations).toEqual([]);
  });

  it('keeps authored email subjects in product language', () => {
    const sourcePath = path.join(
      process.cwd(),
      'src/server/notifications/email-delivery.ts',
    );
    const violations = authoredPropertyCopy(sourcePath, 'subject').flatMap(
      ({ line, text }) =>
        [...text.matchAll(userVisibleTechnicalLanguage)].map(
          (match) =>
            `${path.relative(process.cwd(), sourcePath)}:${line}: ${match[0]}`,
        ),
    );

    expect(violations).toEqual([]);
  });

  it('keeps authored finance comments in product language', () => {
    const commentSources = [
      ...productionSources(serverRoot),
      path.join(process.cwd(), 'helpers/add-registrations.ts'),
    ];
    const violations = commentSources.flatMap((sourcePath) =>
      authoredPropertyCopy(sourcePath, 'comment').flatMap(({ line, text }) =>
        [...text.matchAll(userVisibleTechnicalLanguage)].map(
          (match) =>
            `${path.relative(process.cwd(), sourcePath)}:${line}: ${match[0]}`,
        ),
      ),
    );

    expect(violations).toEqual([]);
  });

  it('keeps hosted checkout item names in product language', () => {
    const violations = hostedCheckoutSources.flatMap((sourcePath) =>
      authoredPropertyCopy(sourcePath, 'name').flatMap(({ line, text }) =>
        [...text.matchAll(userVisibleTechnicalLanguage)].map(
          (match) =>
            `${path.relative(process.cwd(), sourcePath)}:${line}: ${match[0]}`,
        ),
      ),
    );

    expect(violations).toEqual([]);
  });

  it('keeps public RPC errors in product language', () => {
    const violations = productionSources(serverRoot).flatMap((sourcePath) =>
      authoredPublicRpcErrorCopy(sourcePath).flatMap(({ line, text }) =>
        [...text.matchAll(publicErrorTechnicalLanguage)].map(
          (match) =>
            `${path.relative(process.cwd(), sourcePath)}:${line}: ${match[0]}`,
        ),
      ),
    );

    expect(violations).toEqual([]);
  });

  it('keeps public helper messages in product language', () => {
    const publicMessageProperties = ['failureMessage', 'publicMessage'];
    const violations = productionSources(serverRoot).flatMap((sourcePath) =>
      publicMessageProperties.flatMap((propertyName) =>
        authoredPropertyCopy(sourcePath, propertyName).flatMap(
          ({ line, text }) =>
            [...text.matchAll(publicErrorTechnicalLanguage)].map(
              (match) =>
                `${path.relative(process.cwd(), sourcePath)}:${line}: ${match[0]}`,
            ),
        ),
      ),
    );

    expect(violations).toEqual([]);
  });
});
