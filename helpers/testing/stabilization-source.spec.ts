import { readdirSync, readFileSync, statSync } from 'node:fs';
import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (sourcePath: string): string =>
  readFileSync(nodePath.join(repositoryRoot, sourcePath), 'utf8');

const listFiles = (directory: string, extension: string): string[] =>
  readdirSync(nodePath.join(repositoryRoot, directory)).flatMap((entry) => {
    const sourcePath = `${directory}/${entry}`;
    const absolutePath = nodePath.join(repositoryRoot, sourcePath);

    if (statSync(absolutePath).isDirectory()) {
      return listFiles(sourcePath, extension);
    }

    return sourcePath.endsWith(extension) ? [sourcePath] : [];
  });

const readSection = (source: string, heading: string, nextHeading: string) => {
  const match = source.match(
    new RegExp(
      String.raw`## ${heading}\n(?<section>[\s\S]*?)\n## ${nextHeading}`,
      'u',
    ),
  );

  if (!match?.groups?.section) {
    throw new Error(
      `STABILIZATION.md is missing the ${heading} section before ${nextHeading}`,
    );
  }

  return match.groups.section;
};

describe('stabilization source', () => {
  it('keeps the approved event status mapped to published product language', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const eventStatusComponent = readSource(
      'src/app/shared/components/event-status/event-status.component.ts',
    );
    const eventApprovalDocument = readSource(
      'tests/docs/events/event-approval.doc.ts',
    );

    expect(product).toContain(
      'Publishing is the approval act. There is no separate "approved but not published" state for now.',
    );
    expect(eventStatusComponent).toContain("case 'APPROVED'");
    expect(eventStatusComponent).toContain("return 'Published'");
    expect(eventApprovalDocument).toContain(
      "expect(approvedEvent.status).toBe('APPROVED')",
    );
    expect(eventApprovalDocument).toContain('final **Published** state');
    expect(source).toContain('label the persisted `APPROVED` review state as');
    expect(source).toContain('internal enum unchanged');
  });

  it('keeps legal pages from inventing fallback legal copy', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const legalPageComponent = readSource(
      'src/app/core/legal-page/legal-page.component.ts',
    );
    const legalLinksSpec = readSource(
      'src/app/core/tenant-legal-links.spec.ts',
    );

    expect(product).toContain(
      "Evorto should not provide fake fallback legal pages that pretend to cover a tenant's legal obligations.",
    );
    expect(product).toContain(
      'Do not: invent generic legal fallback text and treat it as production-ready.',
    );
    expect(legalPageComponent).toContain(
      'No tenant-provided legal text is configured for this page.',
    );
    expect(legalPageComponent).not.toContain(
      'This legal page has not been configured',
    );
    expect(legalLinksSpec).toContain(
      'does not invent fallback legal text for unconfigured tenant pages',
    );
    expect(source).toContain('unconfigured hosted legal pages now');
    expect(source).toContain('generic fallback legal copy');
  });

  it('keeps ESNcard template pricing behind the tenant provider', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const templateDetails = readSource(
      'src/app/templates/template-details/template-details.component.ts',
    );
    const templateDetailsTemplate = readSource(
      'src/app/templates/template-details/template-details.component.html',
    );
    const templateDetailsSpec = readSource(
      'src/app/templates/template-details/template-details.component.spec.ts',
    );

    expect(product).toContain(
      'ESN-card behavior should be opt-in because not every tenant is an ESN section.',
    );
    expect(product).toContain('- hard-coded ESN-only assumptions');
    expect(templateDetails).toContain('templateEsnDiscountVisible');
    expect(templateDetails).toContain(
      "provider.type === 'esnCard')?.status ===",
    );
    expect(templateDetailsTemplate).toContain('esnEnabled: esnEnabled()');
    expect(templateDetailsSpec).toContain(
      'shows ESNcard template discounts only when the tenant provider is enabled',
    );
    expect(source).toContain(
      'shows them on template detail only while the current tenant ESNcard provider is enabled',
    );
  });

  it('keeps the review status honest about the event archival data-model blocker', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const architecture = readSource('ARCHITECTURE.md');
    const eventSchema = readSource('src/db/schema/event-instances.ts');
    const statusTable = readSection(
      source,
      'Review Status',
      'Product Decision Draft',
    );

    expect(product).toContain(
      'Preserve non-personal event records after the event is archived.',
    );
    expect(architecture).toContain(
      'support archival at the data-model level for relaunch',
    );
    expect(eventSchema).toContain('export const eventReviewStatus = pgEnum');
    expect(eventSchema).toContain("'REJECTED'");
    expect(eventSchema).not.toMatch(/ARCHIVED|archived|archive|archival/u);
    expect(statusTable).toContain('| Events');
    expect(statusTable).toContain('| Blocked');
    expect(statusTable).toContain('event archival data-model support');
    expect(source).toContain(
      'The current `event_instances` schema has only draft, pending',
    );
    expect(source).toMatch(
      /Automatic archival remains out of scope without an\s+explicit product decision, but the archival data model is still missing/u,
    );
  });

  it('keeps the review status honest about the paid transfer relaunch blocker', () => {
    const source = readSource('STABILIZATION.md');
    const statusTable = readSection(
      source,
      'Review Status',
      'Product Decision Draft',
    );

    expect(statusTable).toContain('| Registrations');
    expect(statusTable).toContain('| Blocked');
    expect(statusTable).toContain('unpaid transfer boundaries');
    expect(statusTable).toContain('paid transfer/resale');
    expect(statusTable).toContain('still need implementation');
    expect(statusTable).not.toContain(
      'Free/paid registration, guests, add-ons, waitlist, negative states, cancellation/refund, and transfer boundaries have server, app, spec, and docs coverage.',
    );
  });

  it('keeps the review status honest about registration email notification blockers', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const serverSources = listFiles('src/server', '.ts')
      .map((sourceFile) => readSource(sourceFile))
      .join('\n');
    const packageJson = readSource('package.json');
    const statusTable = readSection(
      source,
      'Review Status',
      'Product Decision Draft',
    );

    expect(product).toContain('Email is the first notification channel.');
    expect(product).toContain(
      'successful registration confirmation, including QR code',
    );
    expect(product).toContain('waitlist spot available');
    expect(product).toContain('registration cancelled by participant or admin');
    expect(product).toContain('transfer completed');
    expect(`${serverSources}\n${packageJson}`).not.toMatch(
      /send(?:Mail|Email)|smtp|resend|mailgun|postmark|nodemailer|aws.*ses|EmailService|MailService/u,
    );
    expect(statusTable).toContain('| Registrations');
    expect(statusTable).toContain('| Blocked');
    expect(statusTable).toContain('registration notification emails');
    expect(source).toMatch(
      /The current server has\s+no mail delivery service or registration lifecycle email side effects yet/u,
    );
    expect(source).toMatch(
      /Registration lifecycle email\s+notifications and receipt-reviewed email notification remain relaunch blockers/u,
    );
  });

  it('keeps the review status honest about the tenant operations-policy blocker', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const tenantSettingsIdentity = readSource(
      'src/app/admin/general-settings/general-settings.identity.ts',
    );
    const adminRpcContract = readSource(
      'src/shared/rpc-contracts/app-rpcs/admin.rpcs.ts',
    );
    const statusTable = readSection(
      source,
      'Review Status',
      'Product Decision Draft',
    );

    expect(product).toContain(
      'limits on how many events a person can register for in a configured time frame',
    );
    expect(product).toContain('payment settings');
    expect(product).toContain('- review/publishing workflow settings');
    expect(product).toContain('- registration limits');
    expect(product).toContain('- email sender name');
    expect(tenantSettingsIdentity).toContain('Email sender');
    expect(tenantSettingsIdentity).toContain('review policy');
    expect(tenantSettingsIdentity).toContain('registration limits');
    expect(tenantSettingsIdentity).toContain('Stripe account management');
    expect(adminRpcContract).not.toMatch(/senderName|sender_name/u);
    expect(adminRpcContract).not.toMatch(/reviewPolicy|review_policy/u);
    expect(adminRpcContract).not.toMatch(
      /registrationLimit|registration_limit/u,
    );
    expect(adminRpcContract).not.toMatch(/stripeAccountId|stripe_account_id/u);
    expect(statusTable).toContain('| Registrations');
    expect(statusTable).toContain('| Tenant/global admin');
    expect(statusTable).toContain('| Blocked');
    expect(statusTable).toContain('tenant operations-policy settings');
    expect(source).toMatch(
      /current registration path does not enforce a tenant registration\s+limit policy/u,
    );
    expect(source).toMatch(
      /tenant-admin settings\s+RPC payload has no email-sender, review-policy, registration-limit, or Stripe\s+account-management fields/u,
    );
  });

  it('keeps the review status honest about the receipt-reviewed email blocker', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const statusTable = readSection(
      source,
      'Review Status',
      'Product Decision Draft',
    );

    expect(product).toContain(
      'Receipt review should support email notification when a receipt is reviewed.',
    );
    expect(statusTable).toContain('| Finance/receipts');
    expect(statusTable).toContain('| Blocked');
    expect(statusTable).toContain('receipt-reviewed email notification');
    expect(source).toContain(
      'the current server has no mail delivery service or receipt-review email side effect yet',
    );
    expect(source).toMatch(
      /current implementation has\s+no server mail delivery service; receipt review currently records the status\s+locally with explicit manual/u,
    );
  });

  it('keeps the review status honest about the home-tenant warning blocker', () => {
    const source = readSource('STABILIZATION.md');
    const product = readSource('PRODUCT.md');
    const usersSchema = readSource('src/db/schema/users.ts');
    const statusTable = readSection(
      source,
      'Review Status',
      'Product Decision Draft',
    );

    expect(product).toContain(
      'A user should ideally have a home tenant so the app can warn when they are browsing a tenant that is not where they usually belong.',
    );
    expect(usersSchema).not.toMatch(/homeTenant|home_tenant/u);
    expect(statusTable).toContain('| Profile/account flows');
    expect(statusTable).toContain('| Blocked');
    expect(statusTable).toContain('home-tenant warning support');
    expect(source).toContain(
      'The current `users` schema has no home-tenant field',
    );
    expect(source).toMatch(
      /does not persist a home\s+tenant or warn when the current tenant differs/u,
    );
  });

  it('keeps the Browser review queue aligned with repeat manual app-flow review', () => {
    const source = readSource('STABILIZATION.md');
    const queue = readSection(source, 'Browser Review Queue', 'Review Next');

    expect(queue).toContain('For repeat Browser review');
    expect(queue).toContain('generated `BASE_URL` from `.env.dev`');
    expect(queue).toContain('local ports can be explicitly pinned for Auth0');
    expect(queue).not.toMatch(/http:\/\/localhost:\d+/u);
    expect(queue).toContain('Anonymous event discovery');
    expect(queue).toContain('Participant registration/profile');
    expect(queue).toContain('Organizer authoring and check-in');
    expect(queue).toContain('Tenant admin and finance');
    expect(queue).toContain('Global admin relaunch scope');
    expect(queue).toContain('Deterministic provider checks');
    expect(queue).toContain('tests/specs/events/events.test.ts');
    expect(queue).toContain('tests/specs/events/unlisted-visibility.test.ts');
    expect(queue).toContain('tests/docs/events/register.doc.ts');
    expect(queue).toContain('tests/docs/profile/*.doc.ts');
    expect(queue).toContain('bun run test:e2e:create-account');
    expect(queue).toContain('tests/specs/admin/global-admin-tenants.spec.ts');
    expect(queue).toContain(
      'tests/specs/permissions/global-admin-route-guard.spec.ts',
    );
    expect(queue).not.toContain('tests/docs/admin/global-admin.doc.ts');
    expect(queue).toContain('bun run test:e2e:esncard-provider');
    expect(queue).toContain(
      'tests/specs/profile/user-profile-esncard-provider.spec.ts',
    );
    expect(queue).toContain('isolated E2E tenant');
    expect(queue).toContain('active `localhost` tenant');
    expect(queue).toContain('TEST-ESN-0001');
    expect(queue).toContain('local review-state drift');
    expect(queue).not.toContain('E2E_LIVE_ESN_CARD_IDENTIFIER');
  });

  it('keeps Review Next scoped to the real remaining blockers', () => {
    const source = readSource('STABILIZATION.md');
    const reviewNext = source.split('## Review Next\n')[1];

    expect(reviewNext).toContain(
      'first manual in-app Browser queue pass has been completed',
    );
    expect(reviewNext).toContain('deterministic ESNcard provider test');
    expect(reviewNext).toContain('provider add/refresh/remove outcomes');
    expect(reviewNext).toContain('custom-domain');
    expect(reviewNext).toContain('multi-domain onboarding');
    expect(reviewNext).toContain('tenant impersonation');
    expect(reviewNext).toContain('documented deferred scope');
    expect(reviewNext).toContain('Docker-backed');
    expect(reviewNext).toContain('system-Chrome coverage');
    expect(reviewNext).toContain('manual Browser review pass');
    expect(reviewNext).toContain('visible profile discount-card UX');
    expect(reviewNext).not.toContain('no active Codex browser pane');
    expect(reviewNext).not.toContain('Transport closed');
    expect(reviewNext).not.toContain('fallback Playwright browser MCP');
    expect(source).not.toContain(
      'Browser walkthrough coverage for anonymous event browsing is enough',
    );
    expect(source).toContain(
      'The first manual in-app Browser walkthrough has now covered the full',
    );
    expect(source).toContain(
      'repeat Browser review should still use the generated `BASE_URL`',
    );
    expect(source).toContain('first in-app Browser queue pass are healthy');
    expect(source).not.toContain(
      'in-app Browser control still times out before manual review can run',
    );
    expect(source).not.toContain('once the local runtime is available');
    expect(source).not.toContain(
      'manual runtime review once in-app Browser navigation is available',
    );
    expect(source).not.toContain(
      'in-app Browser connection still times out during manual global-admin navigation',
    );
    expect(source).not.toContain('Must setup test before interacting');
    expect(source).not.toContain('human Browser pass remains blocked');
    expect(source).not.toContain('visible profile UX review remains blocked');
    expect(source).not.toContain(
      'lists the Browser-backed coverage still\n' +
        '  needed from the remaining stabilization gaps',
    );
  });

  it('keeps the PR readiness checkpoint current without pinning stale heads', () => {
    const source = readSource('STABILIZATION.md');
    const dockerCompose = readSource('docker-compose.yml');
    const endToEndWorkflow = readSource('.github/workflows/e2e-baseline.yml');
    const readinessCheckpoint = source.match(
      /Recent PR readiness checkpoint:[\s\S]*?\n\n## Browser Review Queue/u,
    )?.[0];

    expect(readinessCheckpoint).toBeDefined();
    expect(readinessCheckpoint).not.toMatch(/[0-9a-f]{40}/u);
    expect(readinessCheckpoint).toContain('current PR head');
    expect(readinessCheckpoint).toContain('split Playwright E2E matrix');
    expect(readinessCheckpoint).toContain('Playwright E2E (functional-1)');
    expect(readinessCheckpoint).toContain('Playwright E2E (functional-2)');
    expect(readinessCheckpoint).toContain('Playwright E2E (docs)');
    expect(readinessCheckpoint).toMatch(/roughly\s+ten minutes/u);
    expect(readinessCheckpoint).toContain('low-to-high teens');
    expect(readinessCheckpoint).toContain('functional project is sharded');
    expect(readinessCheckpoint).toContain('slower functional shard');
    expect(readinessCheckpoint).toContain('out after 10 minutes');
    expect(readinessCheckpoint).toMatch(/bounded\s+`on-failure` restarts/u);
    expect(readinessCheckpoint).toContain(
      'transient `423 Client Error: Locked`',
    );
    expect(readinessCheckpoint).toContain('180 seconds');
    expect(readinessCheckpoint).toContain('60-second metadata wait');
    expect(readinessCheckpoint).toContain(
      'prints Compose status and service logs',
    );
    expect(readinessCheckpoint).toMatch(
      /generated\s+screenshot\s+stabilization/u,
    );
    expect(readinessCheckpoint).toContain('run in parallel');
    expect(readinessCheckpoint).toMatch(
      /Chromium-only Playwright browser\s+install/u,
    );
    expect(endToEndWorkflow).toContain('timeout-minutes: 10');
    expect(endToEndWorkflow).toContain('NEON_LOCAL_METADATA_WAIT_SECONDS: 180');
    expect(endToEndWorkflow).toContain(
      'chmod 0777 "${NEON_LOCAL_METADATA_DIR}"',
    );
    expect(endToEndWorkflow).toContain('matrix:');
    expect(endToEndWorkflow).toContain(
      'suite: [functional-1, functional-2, docs]',
    );
    expect(endToEndWorkflow).toContain(
      "if: startsWith(matrix.suite, 'functional-')",
    );
    expect(endToEndWorkflow).toContain('--shard=1/2');
    expect(endToEndWorkflow).toContain('--shard=2/2');
    expect(endToEndWorkflow).toContain("if: matrix.suite == 'docs'");
    expect(dockerCompose).toContain('restart: on-failure:5');
    expect(endToEndWorkflow).not.toContain(
      'Neon Local branch startup hit a transient project lock',
    );
    expect(endToEndWorkflow).not.toContain('return 75');
    expect(endToEndWorkflow).toContain(
      'name: playwright-test-results-${{ matrix.suite }}',
    );
    expect(endToEndWorkflow).toContain('compose_status=$?');
    expect(endToEndWorkflow).toContain('exit "${compose_status}"');
    expect(readinessCheckpoint).toMatch(
      /The PR\s+has\s+no\s+unresolved review threads\s+at/u,
    );
    expect(readinessCheckpoint).toMatch(
      /paid\s+transfer\/resale money movement\s+still needs the product-defined Stripe\s+Checkout replacement and refund workflow/u,
    );
    expect(readinessCheckpoint).toMatch(
      /formal\s+bot\s+review\s+is\s+expected only after the PR is marked ready/u,
    );
    expect(readinessCheckpoint).not.toContain(
      '9b65634b66840aa72dc53c4a5bef742036f049ac',
    );
    expect(readinessCheckpoint).not.toContain('22m26s');
    expect(readinessCheckpoint).not.toContain(
      'unlisted-admin generated-docs menu retry',
    );
    expect(readinessCheckpoint).not.toContain(
      'Node.js 20 actions are deprecated',
    );
    expect(readinessCheckpoint).not.toContain('workflow-pin update');
    expect(readinessCheckpoint).not.toContain(
      '4cfd4d960f1831055153fab0b3321ed55e937284',
    );
    expect(readinessCheckpoint).not.toContain(
      '0d5c1b74de5db7504f2bd833c2e0859adae1a18d',
    );
    expect(readinessCheckpoint).not.toContain(
      '33b163773afeafd93716a21b52ca253ef273a544',
    );
    expect(readinessCheckpoint).not.toContain(
      '584da0dd32867764716132eb2dcdd0bea3e32869',
    );
    expect(readinessCheckpoint).not.toContain('9m16s');
    expect(readinessCheckpoint).not.toContain('13m31s');
    expect(readinessCheckpoint).not.toContain('7m25s');
    expect(readinessCheckpoint).not.toContain('15m18s');
    expect(readinessCheckpoint).not.toContain(
      '96f3f64351c68b645070a63534c839944ffd5440',
    );
    expect(readinessCheckpoint).not.toContain('16m02s');
    expect(readinessCheckpoint).not.toContain(
      '7b39be0f3a89e1fd14982114e8cbf98a5c59af48',
    );
    expect(readinessCheckpoint).not.toContain(
      'fe3c4a669d444b643dbddd6aefea226574d7673d',
    );
    expect(readinessCheckpoint).not.toContain(
      'in-app Browser manual pass is still blocked',
    );
    expect(readinessCheckpoint).not.toContain('E2E_LIVE_ESN_CARD_IDENTIFIER');
  });

  it('opts GitHub JavaScript actions into the Node 24 runtime before the hosted runner cutover', () => {
    const workflowPaths = listFiles('.github/workflows', '.yml').filter(
      (workflowPath) => {
        const workflowSource = readSource(workflowPath);
        return /uses:\s+actions\/(?:checkout|upload-artifact)@/u.test(
          workflowSource,
        );
      },
    );

    expect(workflowPaths).toContain('.github/workflows/e2e-baseline.yml');
    for (const workflowPath of workflowPaths) {
      expect(readSource(workflowPath), workflowPath).toContain(
        'FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true',
      );
    }
  });

  it('keeps paid transfer and resale blocked on the product-defined Stripe replacement workflow', () => {
    const source = readSource('STABILIZATION.md');

    expect(source).toContain('Paid transfer/resale money movement');
    expect(source).toContain(
      'product-defined Stripe Checkout replacement and refund workflow',
    );
    expect(source).toContain('fresh Stripe Checkout');
    expect(source).toContain('Decision: Option B, matching `PRODUCT.md`.');
    expect(source).toContain(
      'The event page shows a disabled transfer action and explains that paid registration transfer and resale need the Stripe Checkout replacement and refund flow first.',
    );
  });

  it('keeps the Playwright inventory clear about watchlist versus blockers', () => {
    const source = readSource('tests/test-inventory.md');

    expect(source).toContain('## Stabilization Coverage Watchlist');
    expect(source).not.toContain('## Stabilization Coverage Still Needed');
    expect(source).toContain(
      'Most are now covered by deterministic specs, generated docs, or source guards',
    );
    expect(source).toContain(
      'first in-app Browser manual review queue pass has now covered',
    );
    expect(source).toMatch(
      /does not satisfy the relaunch transfer\/resale\s+workflow\. `STABILIZATION\.md` keeps registrations blocked until the Stripe\s+Checkout replacement registration and original-registration refund flow is\s+implemented\./u,
    );
    expect(source).not.toContain('E2E_LIVE_ESN_CARD_IDENTIFIER');
  });

  it('keeps finance docs in the baseline docs project', () => {
    const stabilization = readSource('STABILIZATION.md');
    const playwrightConfig = readSource('playwright.config.ts');
    const inventory = readSource('tests/test-inventory.md');

    expect(stabilization).toContain('Finance docs in CI baseline');
    expect(stabilization).toContain('Decision: Option B.');
    expect(stabilization).toContain(
      'Finance docs are product-facing relaunch coverage',
    );
    expect(playwrightConfig).toContain(
      String.raw`testMatch: /docs\/.*\.doc\.ts$/`,
    );
    expect(playwrightConfig).not.toMatch(
      /docs-baseline[\s\S]*testIgnore:[\s\S]*finance/u,
    );
    expect(inventory).toContain('docs/finance/finance-overview.doc.ts');
    expect(inventory).toContain(
      'docs/finance/receipt-review-reimbursement.doc.ts',
    );
  });

  it('keeps quality guidance honest about blocked Browser review', () => {
    const source = readSource('QUALITY.md');

    expect(source).toContain('If Browser is unavailable because the plugin');
    expect(source).toMatch(/control transport is not\s+healthy/u);
    expect(source).toMatch(
      /Do not treat Playwright, screenshots, or system Chrome as a\s+substitute for a requested in-app Browser walkthrough\./u,
    );
    expect(source).toMatch(
      /If Browser could not be used, name the blocker and summarize the fallback\s+validation separately\./u,
    );
  });

  it('keeps scanner camera fallback actions readable', () => {
    const template = readSource(
      'src/app/scanning/scanner/scanner.component.html',
    );
    const source = readSource('STABILIZATION.md');

    expect(template).toContain('bg-error-container text-on-error-container');
    expect(template).toContain(
      'border-on-error-container text-on-error-container',
    );
    expect(template).toContain('role="alert"');
    expect(template).toContain('Try camera again');
    expect(source).toMatch(
      /scanner\s+error state now uses the error-container surface/u,
    );
  });

  it('keeps app code on TanStack Query boolean status narrowing', () => {
    const sourceFiles = [
      ...listFiles('src/app', '.html'),
      ...listFiles('src/app', '.ts'),
    ];

    for (const sourceFile of sourceFiles) {
      const source = readSource(sourceFile);

      expect(source, sourceFile).not.toMatch(
        /\b\w+Query\.status\(\)\s*(?:={2,3}|!={1,2})\s*["'](?:pending|success|error)["']/u,
      );
    }
  });

  it('keeps app templates away from TanStack Query data alias narrowing', () => {
    const sourceFiles = listFiles('src/app', '.html');

    for (const sourceFile of sourceFiles) {
      const source = readSource(sourceFile);

      expect(source, sourceFile).not.toMatch(
        /@if\s*\([^)]*\b\w+Query\.data\(\)\s*;\s*as\s+\w+/u,
      );
    }
  });
});
