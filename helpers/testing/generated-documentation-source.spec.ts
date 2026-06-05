import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import nodePath from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Source guard: generated documentation is product-facing, so these checks keep
// the docs tied to implemented flows instead of stale aspirational copy.
const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (path: string): string =>
  readFileSync(nodePath.join(repositoryRoot, path), 'utf8');

const findFiles = (path: string): string[] => {
  const absolutePath = nodePath.join(repositoryRoot, path);

  return readdirSync(absolutePath).flatMap((entry) => {
    const entryPath = nodePath.join(path, entry);
    const absoluteEntryPath = nodePath.join(repositoryRoot, entryPath);

    return statSync(absoluteEntryPath).isDirectory()
      ? findFiles(entryPath)
      : [entryPath];
  });
};

const findWeakScreenshotCaptions = (path: string, source: string): string[] => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const weakCaptions: string[] = [];

  const describeCall = (node: ts.CallExpression): string => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.expression.getStart(sourceFile),
    );
    return `${path}:${position.line + 1}:${position.character + 1}`;
  };

  const getCaptionText = (node: ts.Expression): null | string => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text.trim();
    }

    return null;
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'takeScreenshot'
    ) {
      const caption = node.arguments[3];
      const captionText = caption ? getCaptionText(caption) : null;

      if (!captionText || captionText.length < 24) {
        weakCaptions.push(describeCall(node));
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return weakCaptions;
};

const collectScreenshotCaptions = (
  path: string,
  source: string,
): Map<string, string[]> => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const captions = new Map<string, string[]>();

  const describeCall = (node: ts.Expression): string => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    return `${path}:${position.line + 1}:${position.character + 1}`;
  };

  const addCaption = (caption: string, location: string): void => {
    const existingLocations = captions.get(caption) ?? [];
    captions.set(caption, [...existingLocations, location]);
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'takeScreenshot'
    ) {
      const caption = node.arguments[3];

      if (
        caption &&
        (ts.isStringLiteral(caption) ||
          ts.isNoSubstitutionTemplateLiteral(caption))
      ) {
        addCaption(caption.text.trim(), describeCall(caption));
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return captions;
};

const findGenericScreenshotTargets = (
  path: string,
  source: string,
): string[] => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const genericTargets: string[] = [];
  const genericSelectors = new Set([
    '*',
    ':root',
    'app-root',
    'body',
    'body, html',
    'html',
    'html, body',
    'main',
  ]);

  const describeCall = (node: ts.CallExpression): string => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.expression.getStart(sourceFile),
    );
    return `${path}:${position.line + 1}:${position.character + 1}`;
  };

  const isGenericLocatorTarget = (node: ts.Expression): boolean => {
    if (ts.isArrayLiteralExpression(node)) {
      return (
        node.elements.length === 0 ||
        node.elements.some((element) => isGenericLocatorTarget(element))
      );
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'locator'
    ) {
      const selector = node.arguments[0];
      if (ts.isStringLiteral(selector)) {
        return genericSelectors.has(selector.text.trim().toLowerCase());
      }
    }

    return false;
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'takeScreenshot'
    ) {
      const target = node.arguments[1];

      if (!target || isGenericLocatorTarget(target)) {
        genericTargets.push(describeCall(node));
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return genericTargets;
};

const findUnfilteredBroadScreenshotTargets = (
  path: string,
  source: string,
): string[] => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const broadTargets: string[] = [];
  const broadSelectors = new Set(['article', 'section']);

  const describeCall = (node: ts.CallExpression): string => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.expression.getStart(sourceFile),
    );
    return `${path}:${position.line + 1}:${position.character + 1}`;
  };

  const isUnfilteredBroadLocatorTarget = (node: ts.Expression): boolean => {
    if (ts.isArrayLiteralExpression(node)) {
      return node.elements.some((element) =>
        isUnfilteredBroadLocatorTarget(element),
      );
    }

    return (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'locator' &&
      ts.isStringLiteral(node.arguments[0]) &&
      broadSelectors.has(node.arguments[0].text.trim().toLowerCase())
    );
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'takeScreenshot'
    ) {
      const target = node.arguments[1];

      if (target && isUnfilteredBroadLocatorTarget(target)) {
        broadTargets.push(describeCall(node));
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return broadTargets;
};

const countTakeScreenshotCalls = (path: string, source: string): number => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let screenshotCount = 0;

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'takeScreenshot'
    ) {
      screenshotCount += 1;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return screenshotCount;
};

const importsSharedScreenshotHelper = (
  path: string,
  source: string,
): boolean => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let importsHelper = false;

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text ===
        '../../support/reporters/documentation-reporter'
    ) {
      const namedBindings = node.importClause?.namedBindings;
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        importsHelper = namedBindings.elements.some(
          (element) => element.name.text === 'takeScreenshot',
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return importsHelper;
};

const findScreenshotHelperBypasses = (
  path: string,
  source: string,
): string[] => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const bypasses: string[] = [];

  const describeNode = (node: ts.Node): string => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    return `${path}:${position.line + 1}:${position.character + 1}`;
  };

  const isScreenshotLikeIdentifier = (name: ts.BindingName): boolean =>
    ts.isIdentifier(name) && /screenshot/iu.test(name.text);

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const moduleSpecifier = node.moduleSpecifier.text;
      const namedBindings = node.importClause?.namedBindings;

      if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          const localName = element.name.text;

          if (
            moduleSpecifier.includes(
              'documentation-reporter/take-screenshot',
            ) &&
            importedName === 'takeScreenshot'
          ) {
            bypasses.push(describeNode(element));
          }

          if (
            moduleSpecifier ===
              '../../support/reporters/documentation-reporter' &&
            importedName === 'takeScreenshot' &&
            localName !== 'takeScreenshot'
          ) {
            bypasses.push(describeNode(element));
          }
        }
      }
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      /screenshot/iu.test(node.name.text)
    ) {
      bypasses.push(describeNode(node.name));
    }

    if (
      ts.isVariableDeclaration(node) &&
      isScreenshotLikeIdentifier(node.name)
    ) {
      bypasses.push(describeNode(node.name));
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return bypasses;
};

describe('generated docs source current behavior', () => {
  it('detects screenshot helper bypass patterns before generated docs can use them', () => {
    const bypassSource = `
      import { takeScreenshot as grabImage } from '../../support/reporters/documentation-reporter';
      import { takeScreenshot } from '../../support/reporters/documentation-reporter/take-screenshot';

      const captureScreenshotEvidence = takeScreenshot;

      function localScreenshot() {
        return captureScreenshotEvidence;
      }
    `;

    expect(
      findScreenshotHelperBypasses(
        'tests/docs/example/bypass.doc.ts',
        bypassSource,
      ),
    ).toEqual([
      'tests/docs/example/bypass.doc.ts:2:16',
      'tests/docs/example/bypass.doc.ts:3:16',
      'tests/docs/example/bypass.doc.ts:5:13',
      'tests/docs/example/bypass.doc.ts:7:16',
    ]);
  });

  it('detects generic documentation screenshot targets', () => {
    const genericTargetSource = `
      await takeScreenshot(
        testInfo,
        page.locator('main'),
        page,
        'Generic application shell target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/generic-target.doc.ts',
        genericTargetSource,
      ),
    ).toEqual(['tests/docs/example/generic-target.doc.ts:2:13']);
  });

  it('detects unfiltered broad documentation screenshot targets', () => {
    const broadTargetSource = `
      await takeScreenshot(
        testInfo,
        page.locator('section'),
        page,
        'Broad page section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('section').filter({ hasText: 'Registration' }),
        page,
        'Filtered registration section target with a descriptive caption',
      );
    `;

    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/broad-target.doc.ts',
        broadTargetSource,
      ),
    ).toEqual(['tests/docs/example/broad-target.doc.ts:2:13']);
  });

  it('keeps generated documentation pages explanatory and image-backed', () => {
    const documentFiles = findFiles('tests/docs')
      .filter((path) => path.endsWith('.doc.ts'))
      .toSorted();
    const textOnlyReferenceDocuments = new Set([
      'tests/docs/roles/about-permissions.doc.ts',
    ]);
    const expectedScreenshotCounts = new Map([
      ['tests/docs/admin/general-settings.doc.ts', 5],
      ['tests/docs/admin/global-admin.doc.ts', 6],
      ['tests/docs/events/event-approval.doc.ts', 6],
      ['tests/docs/events/event-management.doc.ts', 7],
      ['tests/docs/events/register.doc.ts', 13],
      ['tests/docs/events/unlisted-user.doc.ts', 2],
      ['tests/docs/finance/finance-overview.doc.ts', 4],
      ['tests/docs/finance/inclusive-tax-rates.doc.ts', 5],
      ['tests/docs/finance/receipt-review-reimbursement.doc.ts', 4],
      ['tests/docs/profile/discounts.doc.ts', 3],
      ['tests/docs/profile/user-profile.doc.ts', 8],
      ['tests/docs/roles/roles.doc.ts', 4],
      ['tests/docs/template-categories/categories.doc.ts', 5],
      ['tests/docs/templates/templates.doc.ts', 8],
      ['tests/docs/users/create-account.doc.ts', 4],
    ]);
    const screenshotHelper = readSource(
      'tests/support/reporters/documentation-reporter/take-screenshot.ts',
    );
    const expectedImageBackedDocuments = documentFiles.filter(
      (path) => !textOnlyReferenceDocuments.has(path),
    );
    const screenshotCaptions = new Map<string, string[]>();

    expect(documentFiles.length).toBe(16);
    expect([...expectedScreenshotCounts.keys()].toSorted()).toEqual(
      expectedImageBackedDocuments,
    );
    expect(screenshotHelper).toContain(
      'htmlElement.style.outline = `thick solid ${highlightColor}`',
    );
    expect(screenshotHelper).toContain('htmlElement.setAttribute');
    expect(screenshotHelper).toContain("'data-docs-highlight-target'");
    expect(screenshotHelper).toContain("'data-docs-highlight-overlay'");
    expect(screenshotHelper).toContain('element.querySelectorAll');
    expect(screenshotHelper).toContain('countDocumentationHighlightPixels');
    expect(screenshotHelper).toContain('countDocumentationContentPixels');
    expect(screenshotHelper).toContain(
      'Documentation screenshots must include the highlighted focus target.',
    );
    expect(screenshotHelper).toContain(
      'Documentation screenshots must include visible page content outside the highlighted focus target.',
    );
    expect(screenshotHelper).toContain('caption: string');
    expect(screenshotHelper).toContain('caption.trim().length < 24');
    expect(screenshotHelper).toContain(
      'Documentation screenshots require a descriptive caption',
    );
    expect(screenshotHelper).toContain("testInfo.attach('image'");
    expect(screenshotHelper).toContain("testInfo.attach('image-caption'");
    expect(
      readSource('tests/specs/reporting/reporter-paths.test.ts'),
    ).toContain(
      'documentation screenshot helper highlights a visible child for zero-box hosts',
    );
    expect(
      readSource('tests/specs/reporting/reporter-paths.test.ts'),
    ).toContain(
      'documentation screenshot helper rejects captures without visible page content',
    );

    for (const path of documentFiles) {
      const source = readSource(path);
      const markdownBodies = source.match(/body:\s*`[\s\S]*?`/gu) ?? [];
      const markdownTextLength = markdownBodies
        .map((body) =>
          body
            .replaceAll('`', '')
            .replaceAll(/\$\{[\s\S]*?\}/gu, '')
            .replaceAll(/\s+/gu, ' ')
            .trim(),
        )
        .join(' ').length;

      expect(source, path).toContain("testInfo.attach('markdown'");
      expect(markdownTextLength, path).toBeGreaterThanOrEqual(120);
      expect(source, path).not.toContain('waitForTimeout(');
      expect(source, path).not.toContain('.waitForTimeout(');

      if (textOnlyReferenceDocuments.has(path)) {
        expect(source, path).toContain('PERMISSION_GROUPS');
        expect(source, path).toContain('permissionLines');
        expect(source, path).not.toContain('takeScreenshot(');
        expect(expectedScreenshotCounts.has(path), path).toBe(false);
        continue;
      }

      expect(source, path).toContain('takeScreenshot(');
      expect(countTakeScreenshotCalls(path, source), path).toBe(
        expectedScreenshotCounts.get(path),
      );
      expect(importsSharedScreenshotHelper(path, source), path).toBe(true);
      expect(source, path).not.toContain('page.screenshot(');
      expect(findWeakScreenshotCaptions(path, source), path).toEqual([]);
      expect(findUnfilteredBroadScreenshotTargets(path, source), path).toEqual(
        [],
      );
      for (const [caption, locations] of collectScreenshotCaptions(
        path,
        source,
      )) {
        screenshotCaptions.set(caption, [
          ...(screenshotCaptions.get(caption) ?? []),
          ...locations,
        ]);
      }
      expect(findGenericScreenshotTargets(path, source), path).toEqual([]);
      expect(findScreenshotHelperBypasses(path, source), path).toEqual([]);
    }

    expect(
      [...screenshotCaptions.entries()]
        .filter(([, locations]) => locations.length > 1)
        .map(
          ([caption, locations]) =>
            `${caption}: ${locations.toSorted().join(', ')}`,
        ),
    ).toEqual([]);
  });

  it('keeps generated documentation publishing explicit in package scripts', () => {
    const packageJson = JSON.parse(readSource('package.json')) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};
    const localDocumentationScripts = [
      'test:e2e:docs',
      'test:e2e:integration',
      'test:e2e:create-account',
    ];

    for (const scriptName of localDocumentationScripts) {
      const script = scripts[scriptName];

      expect(script, scriptName).toContain('DOCS_OUT_DIR=test-results/docs');
      expect(script, scriptName).toContain(
        'DOCS_IMG_OUT_DIR=test-results/docs/images',
      );
      expect(script, scriptName).not.toContain(
        '/Users/hedde/code/evorto-pages',
      );
    }

    expect(scripts['test:e2e:docs:publish']).toContain(
      'DOCS_OUT_DIR=/Users/hedde/code/evorto-pages/apps/documentation/src/app/docs',
    );
    expect(scripts['test:e2e:docs:publish']).toContain(
      'DOCS_IMG_OUT_DIR=/Users/hedde/code/evorto-pages/apps/documentation/public/docs',
    );
    expect(scripts['test:e2e:docs:publish']).toContain(
      'playwright test --project=docs-baseline',
    );
  });

  it('keeps tenant general-settings docs aligned with implemented branding and legal routes', () => {
    const source = readSource('tests/docs/admin/general-settings.doc.ts');

    expect(source).not.toContain(
      'domain onboarding, brand asset upload, legal text page',
    );
    expect(source).toContain(
      'A read-only **Tenant identity** summary with tenant name, primary domain, and Stripe connection state.',
    );
    expect(source).toContain('const generalSettingsSection =');
    expect(source).toContain('const generalSettingsField =');
    expect(source).toContain('const generalSettingsToggle =');
    expect(source).toContain('const generalSettingsCheckbox =');
    expect(source).toContain("locator('app-general-settings section')");
    expect(source).toContain("locator('app-general-settings mat-form-field')");
    expect(source).toContain(
      "locator('app-general-settings mat-slide-toggle')",
    );
    expect(source).toContain("locator('app-general-settings mat-checkbox')");
    expect(source).toContain("generalSettings.getByText('Domain onboarding')");
    expect(source).toContain(
      'Custom-domain verification and multi-domain automation are deferred.',
    );
    expect(source).toContain(
      "generalSettings.getByText('Primary domain', { exact: true })",
    );
    expect(source).toContain(
      "generalSettings.getByText('Stripe account', { exact: true })",
    );
    expect(source).toContain("generalSettings.getByLabel('Currency')");
    expect(source).toContain("generalSettings.getByLabel('Locale')");
    expect(source).toContain("generalSettings.getByLabel('Timezone')");
    expect(source).toContain(
      "generalSettings.getByLabel('Event review policy')",
    );
    expect(source).toContain(
      "generalSettings.getByLabel('Stripe account management')",
    );
    expect(source).toContain("generalSettings.getByLabel('Email sender name')");
    expect(source).toContain("generalSettings.getByLabel('Logo URL')");
    expect(source).toContain("generalSettings.getByLabel('Favicon URL')");
    expect(source).toContain("generalSettings.getByLabel('SEO title')");
    expect(source).toContain("generalSettings.getByLabel('SEO description')");
    expect(source).toContain(
      "generalSettings.getByLabel('Imprint / legal notice URL')",
    );
    expect(source).toContain(
      "generalSettings.getByLabel('Hosted imprint / legal notice text')",
    );
    expect(source).toContain(
      "generalSettings.getByLabel('Privacy policy URL')",
    );
    expect(source).toContain(
      "generalSettings.getByLabel('Hosted privacy policy text')",
    );
    expect(source).toContain("generalSettings.getByLabel('Terms URL')");
    expect(source).toContain("generalSettings.getByLabel('Hosted terms text')");
    expect(source).toContain(
      "generalSettings.getByLabel('Allowed receipt countries')",
    );
    expect(source).toContain("generalSettings.getByLabel('Allow other')");
    expect(source).toContain("generalSettings.getByText('ESN Card discounts')");
    expect(source).toContain(
      "generalSettings.getByRole('button', { name: 'Save' })",
    );
    expect(source).toContain('const deferredSettingsSummary =');
    expect(source).toContain('const tenantIdentitySummary =');
    expect(source).toContain('const brandAndSearchSettingsFields =');
    expect(source).toContain('const legalPageSettingsFields =');
    expect(source).toContain('const financeAndDiscountSettingsControls =');
    expect(source).toContain(
      'await expect(deferredSettingsSummary).toBeVisible()',
    );
    expect(source).toContain(
      'await expect(tenantIdentitySummary).toBeVisible()',
    );
    expect(source).toContain(
      'for (const field of brandAndSearchSettingsFields)',
    );
    expect(source).toContain('for (const field of legalPageSettingsFields)');
    expect(source).toContain(
      'for (const control of financeAndDiscountSettingsControls)',
    );
    expect(source).toContain(
      "generalSettingsField(page, 'Allowed receipt countries')",
    );
    expect(source).toContain("generalSettingsCheckbox(page, 'Allow other')");
    expect(source).toContain(
      "generalSettingsToggle(page, 'ESN Card discounts')",
    );
    expect(source).toContain(
      "generalSettings.getByRole('button', { name: 'Save' })",
    );
    expect(source).toContain(
      'Tenant identity summary showing primary domain and Stripe status',
    );
    expect(source).toContain(
      'Brand asset and search preview settings for tenant public pages',
    );
    expect(source).toContain(
      'Legal page fields for hosted imprint privacy and terms content',
    );
    expect(source).not.toContain(
      'takeScreenshot(\n    testInfo,\n    emailSenderField,',
    );
    expect(source).not.toContain(
      'takeScreenshot(\n    testInfo,\n    hostedTermsField,',
    );
    expect(source).toContain(
      'Receipt and ESN card discount settings near the save action',
    );
    expect(source).not.toContain(
      "const esnDiscountToggle = generalSettingsToggle(page, 'ESN Card discounts');",
    );
    expect(source).not.toContain(
      'takeScreenshot(\n    testInfo,\n    esnDiscountToggle,',
    );
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    generalSettings.getByRole('heading'",
    );
    expect(source).toContain(
      'One-domain-per-tenant remains the current relaunch scope in the application schema.',
    );
    expect(source).toContain(
      'keeps an in-app deferred-settings summary for custom-domain verification and multi-domain automation',
    );
    expect(source).toContain(
      '**Currency**, **Locale**, and **Timezone** selection within the supported relaunch policy.',
    );
    expect(source).toContain(
      '**SEO title** and **SEO description** for tenant-level page metadata.',
    );
    expect(source).toContain(
      '**Email sender name** for tenant email notification display names.',
    );
    expect(source).toContain('participant registration limits');
    expect(source).toContain(
      'hosted text appears at \\`/legal/imprint\\`, \\`/legal/privacy\\`, and \\`/legal/terms\\`',
    );
    expect(source).toContain(
      '**Allowed receipt countries** and **Allow other** for receipt submission.',
    );
    expect(source).toContain(
      '**ESN Card discounts** and optional **Buy ESNcard URL** when the tenant uses ESNcard validation.',
    );
    expect(source).toContain(
      'Tax rates are managed on the separate **Tax Rates** page.',
    );
    expect(source).toContain(
      'Currency, locale, and timezone changes are only accepted before event or payment data exists for the tenant.',
    );
    expect(source).toContain(
      'When one of those accepted changes is saved, Evorto reloads the app',
    );
    expect(source).not.toContain('Tax rates are configured here');
    expect(source).not.toContain(
      'Stripe account management is configured here',
    );
  });

  it('keeps global-admin docs focused on implemented relaunch tenant operations', () => {
    const inventorySource = readSource('tests/test-inventory.md');
    const globalAdminSource = readSource(
      'tests/docs/admin/global-admin.doc.ts',
    );
    const unlistedUserSource = readSource(
      'tests/docs/events/unlisted-user.doc.ts',
    );
    const documentFiles = findFiles('tests/docs');
    const generatedDocumentSources = documentFiles
      .map((path) => [path, readSource(path)] as const)
      .filter(([path]) => path.endsWith('.doc.ts'));

    expect(
      existsSync(
        nodePath.join(repositoryRoot, 'tests/docs/admin/global-admin.doc.ts'),
      ),
    ).toBe(true);
    expect(
      existsSync(
        nodePath.join(
          repositoryRoot,
          'tests/docs/events/unlisted-admin.doc.ts',
        ),
      ),
    ).toBe(false);
    expect(inventorySource).toContain('docs/admin/global-admin.doc.ts');
    expect(inventorySource).not.toContain('docs/events/unlisted-admin.doc.ts');
    expect(globalAdminSource).toContain(
      "test('Global admin: manage tenants @admin @globalAdmin'",
    );
    expect(globalAdminSource).toContain('# Global Tenant Administration');
    expect(globalAdminSource).toContain(
      'Global tenant list with search and tenant operational summary rows',
    );
    expect(globalAdminSource).toContain('const tenantSummaryCard =');
    expect(globalAdminSource).toContain('filter({ hasText: tenantDomain })');
    expect(globalAdminSource).toContain("filter({ hasText: 'Details' })");
    expect(globalAdminSource).toContain(
      'Empty tenant search result explaining no matching tenants were found',
    );
    expect(globalAdminSource).toContain('const tenantSearchEmptyState =');
    expect(globalAdminSource).toContain(
      'Try another name, domain, locale, timezone, or Stripe account.',
    );
    expect(globalAdminSource).toContain(
      'Create tenant form showing the relaunch tenant scope boundaries',
    );
    expect(globalAdminSource).toContain('const tenantScopeCard =');
    expect(globalAdminSource).toContain("locator('form > div')");
    expect(globalAdminSource).toContain(
      'Create tenant form preserving URL-shaped domain input after rejection',
    );
    expect(globalAdminSource).toContain(
      'Tenant detail review with read-only operational fields and actions',
    );
    expect(globalAdminSource).toContain('const tenantDetailReviewCard =');
    expect(globalAdminSource).toContain(
      "filter({ hasText: 'Open tenant domain' })",
    );
    expect(globalAdminSource).toContain(
      'Edit tenant form with relaunch-scoped tenant settings ready to save',
    );
    expect(globalAdminSource).toContain('const tenantEditForm =');
    expect(globalAdminSource).toContain("locator('form')");
    expect(globalAdminSource).toContain(
      "filter({ has: tenantEdit.getByLabel('Tenant name') })",
    );
    expect(globalAdminSource).toContain(
      "filter({ has: tenantEdit.getByLabel('Primary domain') })",
    );
    expect(globalAdminSource).toContain(
      "tenantEdit.getByRole('heading', { name: 'Relaunch tenant scope' })",
    );
    expect(globalAdminSource).toContain(
      "filter({ has: tenantEdit.getByRole('button', { name: 'Save tenant' }) })",
    );
    expect(globalAdminSource).not.toContain(
      "const tenantEditForm = (tenantEdit: Locator) =>\n  tenantEdit.locator('form').first();",
    );
    expect(globalAdminSource).not.toContain(
      "takeScreenshot(\n    testInfo,\n    tenantList.getByRole('heading'",
    );
    expect(globalAdminSource).not.toContain(
      "takeScreenshot(\n    testInfo,\n    tenantCreate.getByRole('heading'",
    );
    expect(globalAdminSource).not.toContain(
      "takeScreenshot(\n    testInfo,\n    tenantDetail.getByRole('heading'",
    );
    expect(globalAdminSource).not.toContain(
      "takeScreenshot(\n    testInfo,\n    tenantEdit.getByRole('heading'",
    );
    expect(globalAdminSource).toContain('/global-admin/tenants');
    expect(globalAdminSource).toContain('Relaunch tenant scope');
    expect(globalAdminSource).toContain(
      'One active primary domain is managed here.',
    );
    expect(globalAdminSource).toContain(
      'Custom-domain verification and multi-domain automation are deferred.',
    );
    expect(globalAdminSource).toContain(
      'Tenant-admin impersonation is not available in the current relaunch surface.',
    );
    expect(globalAdminSource).not.toMatch(
      /custom.?domain verification is implemented/i,
    );
    expect(globalAdminSource).not.toMatch(/multiple domains? can be managed/i);
    expect(globalAdminSource).not.toMatch(/impersonat(?:e|ion) tenant/i);
    expect(unlistedUserSource).toContain(
      "test('User: understanding unlisted events'",
    );
    expect(unlistedUserSource).toContain('# Unlisted Events (User)');
    expect(unlistedUserSource).toContain(
      'Expected an approved listed event in the seeded events',
    );
    expect(unlistedUserSource).toContain(
      'Expected a second approved listed event for unlisted docs list context',
    );
    expect(unlistedUserSource).toContain('const listedContextEvent =');
    expect(unlistedUserSource).toContain('const visibleListedEventLink =');
    expect(unlistedUserSource).toContain("locator('app-event-list nav a')");
    expect(unlistedUserSource).toContain(
      "has: page.getByRole('heading', { level: 2, name: eventTitle })",
    );
    expect(unlistedUserSource).toContain(
      'Visible listed event card while the unlisted event is hidden from the event list',
    );
    expect(unlistedUserSource).toContain('set({ unlisted: true })');
    expect(unlistedUserSource).not.toContain(
      "page.locator('app-event-list nav a').first()",
    );
    expect(unlistedUserSource).not.toContain(
      'User-facing events list with visible events while unlisted event stays hidden',
    );
    expect(unlistedUserSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-event-list nav').first(),",
    );
    expect(unlistedUserSource).toContain('eventRegistrationSection');
    expect(unlistedUserSource).toContain(
      "page.getByRole('heading', { level: 2, name: 'Registration' })",
    );
    expect(unlistedUserSource).toContain(
      'const eventRegistrationOptionSurface =',
    );
    expect(unlistedUserSource).toContain(
      "locator('app-event-registration-option')",
    );
    expect(unlistedUserSource).toContain(
      "has: page.getByRole('heading', { name: input.optionTitle })",
    );
    expect(unlistedUserSource).toContain(
      'eq(schema.eventRegistrationOptions.organizingRegistration, false)',
    );
    expect(unlistedUserSource).toContain(
      'Expected unlisted docs event "${event.title}" to have a visible participant registration option',
    );
    expect(unlistedUserSource).toContain(
      'const registrationOption = eventRegistrationOptionSurface(page',
    );
    expect(unlistedUserSource).toContain(
      'testInfo,\n      registrationOption,',
    );
    expect(unlistedUserSource).not.toContain(
      "registrationSection.locator('app-event-registration-option').first()",
    );
    expect(unlistedUserSource).toContain(
      'Direct link opens the unlisted event registration details',
    );
    expect(unlistedUserSource).toContain('set({ unlisted: event.unlisted })');
    expect(unlistedUserSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.getByRole('heading', { name: event.title }),\n      page,\n      'Direct link opens the unlisted event detail page'",
    );
    expect(unlistedUserSource).not.toMatch(/admin|global-admin|global admin/i);
    expect(documentFiles).toEqual(
      expect.arrayContaining(['tests/docs/admin/global-admin.doc.ts']),
    );
    for (const [path, source] of generatedDocumentSources) {
      if (path !== 'tests/docs/admin/global-admin.doc.ts') {
        expect(source, path).not.toContain('/global-admin');
        expect(source, path).not.toMatch(/global-admin|global admin/i);
      }
    }
  });

  it('keeps profile docs aligned with implemented account and event-card behavior', () => {
    const source = readSource('tests/docs/profile/user-profile.doc.ts');

    expect(source).toContain(
      'Login email address and notification email address',
    );
    expect(source).toContain(
      'IBAN and PayPal details are optional global reimbursement details, not tenant-specific payout instructions.',
    );
    expect(source).toContain(
      'The notification email is user-managed and may differ from the Auth0 login email.',
    );
    expect(source).toContain(
      'Optional IBAN and PayPal fields store global reimbursement details for finance teams.',
    );
    expect(source).toContain('documentedIban');
    expect(source).toContain('documentedPaypalEmail');
    expect(source).toContain("getByRole('textbox', { name: 'IBAN' })");
    expect(source).toContain("getByRole('textbox', { name: 'PayPal email' })");
    expect(source).toContain('updatedProfileUser.iban).toBe(documentedIban)');
    expect(source).toContain(
      'updatedProfileUser.paypalEmail).toBe(documentedPaypalEmail)',
    );
    expect(source).toContain(
      'Profile event cards point pending checkout registrations at the implemented profile action, route ticket/cancellation/unpaid-transfer details back to the event page, expose waitlist routing back to the event page, and stop advertising cancellation or transfer once a registration is checked in',
    );
    expect(source).toContain(
      'Continue payment from this card, or open the event page for registration details.',
    );
    expect(source).toContain(
      'Open the event page for waitlist details and the leave-waitlist action.',
    );
    expect(source).toContain(
      '`/events/${profileEventCards.confirmed.eventId}`',
    );
    expect(source).toContain(
      '`/events/${profileEventCards.pendingCheckout.eventId}`',
    );
    expect(source).toContain('`/events/${profileEventCards.waitlist.eventId}`');
    expect(source).toContain(
      '`/events/${profileEventCards.checkedIn.eventId}`',
    );
    expect(source).toContain("getByRole('link', { name: 'Continue payment' })");
    expect(source).toContain('pendingCheckoutRegistration');
    expect(source).toContain('checkedInAddonPurchase');
    expect(source).toContain('const profileSummarySurface =');
    expect(source).toContain("locator('app-user-profile section')");
    expect(source).toContain("button', { name: 'Edit profile' })");
    expect(source).toContain('const profileNavigationSurface =');
    expect(source).toContain("locator('.navigation')");
    expect(source).toContain(
      "has: page.getByRole('link', { name: 'Profile' })",
    );
    expect(source).toContain('const profileEditDialogSurface =');
    expect(source).toContain("locator('mat-dialog-container')");
    expect(source).toContain(
      "has: page.getByRole('heading', { name: 'Edit profile' })",
    );
    expect(source).toContain(
      "has: page.getByRole('textbox', { name: 'First name' })",
    );
    expect(source).toContain(
      "has: page.getByRole('textbox', { name: 'Last name' })",
    );
    expect(source).toContain(
      "has: page.getByRole('textbox', { name: 'Notification email' })",
    );
    expect(source).toContain(
      "has: page.getByRole('textbox', { name: 'IBAN' })",
    );
    expect(source).toContain(
      "has: page.getByRole('textbox', { name: 'PayPal email' })",
    );
    expect(source).toContain("has: page.getByRole('button', { name: 'Save' })");
    expect(source).toContain(
      'User profile overview with section navigation and personal details',
    );
    expect(source).toContain('[profileNavigation, profileSummary]');
    expect(source).toContain('const profileEventCardSurface =');
    expect(source).toContain('filter({ hasText: eventTitle })');
    expect(source).toContain('hasText: addOnTitle');
    expect(source).toContain('const profileEventsSectionSurface =');
    expect(source).toContain(
      "has: page.getByRole('heading', { name: 'Your Event Registrations' })",
    );
    expect(source).toContain('const profileReceiptCardSurface =');
    expect(source).toContain('filter({ hasText: receiptFileName })');
    expect(source).toContain(
      'You are checked in. Open the event page for ticket details. Cancellation and transfer are no longer available after check-in.',
    );
    expect(source).toContain('Submitted receipts');
    expect(source).toContain('profile-docs-receipt-');
    expect(source).toContain('schema.financeReceipts');
    expect(source).toContain('profileReceiptCard.getByText');
    expect(source).toContain('profileReceiptFileName');
    expect(source).toContain('Submitted');
    expect(source).toContain('profileEvent.title');
    expect(source).toContain('18.75 €');
    expect(source).toContain(
      'Profile events tab showing confirmed, pending, waitlist, and checked-in registrations',
    );
    expect(source).toContain('[\n        profileEventsSectionSurface(page),');
    expect(source).toContain(
      'documentedEventCard,\n        pendingCheckoutCard',
    );
    expect(source).toContain('waitlistCard,\n        checkedInEventCard');
    expect(source).toContain(
      'Expected generated profile docs user after update',
    );
    expect(source).toContain('updatedProfileUser.communicationEmail).toBe');
    expect(source).toContain(
      'Expected generated profile docs receipt after read',
    );
    expect(source).toContain('attachmentFileName: profileReceiptFileName');
    expect(source).toContain('totalAmount: 1875');
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-user-profile'),\n      page,\n      'Profile events tab showing the user registration history'",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      documentedEventCard,\n      page,\n      'Profile events tab showing the user registration history'",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-user-profile'),\n      page,\n      'Profile receipts tab showing submitted reimbursement receipts'",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-user-profile'),\n      page,\n      'User profile page showing personal details and profile tabs'",
    );
    expect(source).not.toContain(
      "const editDialog = page.locator('mat-dialog-container');",
    );
    expect(source).not.toContain('automatic refund');
    expect(source).not.toContain('resale');
    expect(source).not.toContain('ticket email');
  });

  it('keeps account-creation docs aligned with notification-email and retry semantics', () => {
    const source = readSource('tests/docs/users/create-account.doc.ts');

    expect(source).toContain(
      'The account form pre-fills first name, last name, and **Notification email** from Auth0 data when available.',
    );
    expect(source).toContain(
      'It stays disabled while invalid, already submitting, or waiting for the account-creation mutation',
    );
    expect(source).toContain(
      'Existing global users with the same Auth0 id join the current tenant instead of creating a duplicate global user.',
    );
    expect(source).toContain(
      'Profile page after tenant account creation succeeds',
    );
    expect(source).toContain('createAccountLoginSurface');
    expect(source).toContain("locator('app-navigation')");
    expect(source).toContain(
      "filter({ has: page.getByRole('link', { name: 'Events' }) })",
    );
    expect(source).toContain(
      "filter({ has: page.getByRole('link', { name: 'Login' }) })",
    );
    expect(source).toContain('const loginSurface =');
    expect(source).toContain(
      'Application navigation showing the login entry point',
    );
    expect(source).toContain('auth0LoginFormSurface');
    expect(source).toContain("locator('form')");
    expect(source).toContain(
      "filter({ has: page.getByLabel('Email address') })",
    );
    expect(source).toContain(
      "filter({ has: page.getByRole('textbox', { name: 'Password' }) })",
    );
    expect(source).toContain(
      "has: page.getByRole('button', { exact: true, name: 'Continue' })",
    );
    expect(source).toContain('const auth0LoginForm =');
    expect(source).toContain(
      'Auth0 login form requesting the tenant account email address',
    );
    expect(source).toContain('createAccountFormSurface');
    expect(source).toContain("locator('app-create-account form')");
    expect(source).toContain(
      "has: page.getByRole('textbox', { name: 'Notification email' })",
    );
    expect(source).toContain(
      "has: page.getByRole('button', { exact: true, name: 'Create Account' })",
    );
    expect(source).toContain('createdProfileSummarySurface');
    expect(source).toContain("locator('app-user-profile section')");
    expect(source).toContain('filter({ hasText: input.fullName })');
    expect(source).toContain('filter({ hasText: input.notificationEmail })');
    expect(source).toContain("filter({ hasText: 'Edit profile' })");
    expect(source).toContain(
      'If account creation fails, the page shows a retryable server error instead of silently losing the submit attempt.',
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.getByRole('heading', {\n        level: 1,\n        name: `${newUser.firstName} ${newUser.lastName}`,\n      }),\n      page,\n      'Profile page after tenant account creation succeeds'",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.getByRole('link', { name: 'Login' }),",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.getByLabel('Email address'),",
    );
    expect(source).not.toContain(
      "const createAccountForm = page\n      .locator('form')\n      .filter({ has: createAccountButton })\n      .first();",
    );
    expect(source).not.toContain('login email as your notification email');
    expect(source).not.toContain('tenant-specific notification email');
  });

  it('keeps finance receipt docs aligned with queued notification and manual reimbursement scope', () => {
    const overviewSource = readSource(
      'tests/docs/finance/finance-overview.doc.ts',
    );
    const receiptSource = readSource(
      'tests/docs/finance/receipt-review-reimbursement.doc.ts',
    );
    const combinedSource = `${overviewSource}\n${receiptSource}`;

    expect(combinedSource).toContain(
      'queues the submitter email notification for delivery',
    );
    expect(combinedSource).toContain('queues a submitter email after saving');
    expect(combinedSource).toContain(
      'Recording a reimbursement creates the Evorto finance transaction only.',
    );
    expect(combinedSource).toContain(
      'Transfer the money manually through the selected payout method.',
    );
    expect(combinedSource).toContain(
      'actual money movement remains a manual finance operation',
    );
    expect(combinedSource).toContain('queues the submitter email for delivery');
    expect(receiptSource).toContain(
      'Expected generated receipt review docs receipt',
    );
    expect(receiptSource).toContain(
      "page.getByRole('link', { name: receiptFileName })",
    );
    expect(receiptSource).toContain('const approvalQueueReceiptSurface =');
    expect(receiptSource).toContain(
      "locator('app-receipt-approval-list section')",
    );
    expect(receiptSource).toContain('const receiptReviewDecisionSurface =');
    expect(receiptSource).toContain(
      "locator('app-receipt-approval-detail section')",
    );
    expect(receiptSource).toContain(
      "has: page.getByRole('heading', { name: 'Receipt data' })",
    );
    expect(receiptSource).toContain('return approvedReceipt?.status');
    expect(receiptSource).toContain('filter({ hasText: receiptFileName })');
    expect(receiptSource).toContain(
      'const recordedReimbursementStateSurface =',
    );
    expect(receiptSource).toContain(
      "filter({ has: page.getByText('Selected total: 0.00 €') })",
    );
    expect(receiptSource).toContain(
      'Receipt reimbursement page after recording the manual transaction',
    );
    expect(receiptSource).toContain('refundTransactionId: expect.any(String)');
    expect(receiptSource).toContain("status: 'refunded'");
    expect(receiptSource).toContain('.delete(schema.transactions)');
    expect(combinedSource).not.toContain('sends an automatic submitter email');
    expect(combinedSource).not.toContain('automatic email');
    expect(combinedSource).not.toContain('automatically transfer');
    expect(combinedSource).not.toContain('automatic money movement');
    expect(receiptSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-receipt-approval-list'),",
    );
    expect(receiptSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-receipt-approval-detail'),",
    );
    expect(receiptSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-receipt-refund-list'),",
    );
  });

  it('keeps inclusive tax-rate docs focused on seeded compatible rows and paid option controls', () => {
    const source = readSource('tests/docs/finance/inclusive-tax-rates.doc.ts');

    expect(source).toContain('taxRateSection');
    expect(source).toContain('taxRateRow');
    expect(source).toContain('importStripeTaxRatesDialogSurface');
    expect(source).toContain('eventPaidRegistrationOptionForm');
    expect(source).toContain('Compatible Tax Rates');
    expect(source).toContain('txr_1S6a7sPPcz51fqyK4AVB8NSS');
    expect(source).toContain('txr_1S6a8LPPcz51fqyK4CPonBgy');
    expect(source).toContain(
      'Compatible inclusive tax-rate rows available for paid registrations',
    );
    expect(source).toContain(
      'Import Stripe tax rates dialog with compatible imported VAT rows',
    );
    expect(source).toContain("importDialog.locator('mat-checkbox').first()");
    expect(source).toContain("importDialog.getByText('included').first()");
    expect(source).toContain("importDialog.getByText('imported').first()");
    expect(source).toContain(
      'Event edit paid registration option tax-rate controls',
    );
    expect(source).toContain('Inclusive tax; shown price is final');
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('mat-dialog-container'),",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-tax-rates-settings'),\n      page,\n      'Tax rates overview showing inclusive rate management'",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      eventEditTax.first(),\n      page,\n      'Event edit tax rate selector'",
    );
  });

  it('keeps finance overview docs aligned with permission-scoped navigation', () => {
    const source = readSource('tests/docs/finance/finance-overview.doc.ts');

    expect(source).toContain(
      'Each child page is guarded by its own finance permission.',
    );
    expect(source).toContain('The finance overview is a navigation surface.');
    expect(source).toContain(
      'It shows links only for the finance capabilities you have, so users with receipt approval access do not automatically see the transaction list.',
    );
    expect(source).toContain(
      '- **finance:viewTransactions**: view the tenant transaction list.',
    );
    expect(source).toContain(
      '- **finance:approveReceipts**: review submitted receipts.',
    );
    expect(source).toContain(
      '- **finance:refundReceipts**: record receipt reimbursement batches.',
    );
    expect(source).toContain('visibleTransactionComment');
    expect(source).toContain('cancelledTransactionComment');
    expect(source).toContain('submittedReceiptFileName');
    expect(source).toContain('approvedReceiptFileName');
    expect(source).toContain('const financeOverviewNavigationSurface =');
    expect(source).toContain("locator('app-finance-overview nav')");
    expect(source).toContain(
      "filter({ has: page.getByRole('link', { name: 'Transactions' }) })",
    );
    expect(source).toContain(
      "filter({ has: page.getByRole('link', { name: 'Receipt approvals' }) })",
    );
    expect(source).toContain(
      "has: page.getByRole('link', { name: 'Receipt reimbursements' })",
    );
    expect(source).toContain('const financeOverviewNavigationCard =');
    expect(source).toContain("locator('app-finance-overview nav a')");
    expect(source).toContain('const financeNavigation =');
    expect(source).toContain('const transactionRow =');
    expect(source).toContain(
      "page.getByRole('row').filter({ hasText: comment })",
    );
    expect(source).toContain('const receiptApprovalRow =');
    expect(source).toContain("locator('app-receipt-approval-list a')");
    expect(source).toContain('const receiptReimbursementRow =');
    expect(source).toContain('const transactionNavigationCard =');
    expect(source).toContain('const visibleTransactionRow =');
    expect(source).toContain('const submittedReceiptRow =');
    expect(source).toContain('const approvedReceiptRow =');
    expect(source).toContain(
      'Cancelled transactions are omitted from this list.',
    );
    expect(source).toContain(
      'page.getByText(cancelledTransactionComment)).toHaveCount(0)',
    );
    expect(source).toContain(
      'page.getByText(submittedReceiptFileName)).toBeVisible()',
    );
    expect(source).toContain(
      'page.getByText(approvedReceiptFileName)).toBeVisible()',
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-finance-overview')",
    );
    expect(source).not.toContain(
      'takeScreenshot(\n      testInfo,\n      transactionNavigationCard,',
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-transaction-list')",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-receipt-approval-list')",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-receipt-refund-list')",
    );
    expect(source).not.toContain('all finance users see all finance pages');
    expect(source).not.toContain(
      'receipt approval access includes transactions',
    );
    expect(source).not.toContain('single finance permission');
  });

  it('keeps template docs aligned with the simple-mode relaunch surface', () => {
    const source = readSource('tests/docs/templates/templates.doc.ts');

    expect(source).toContain(
      'Simple mode intentionally keeps exactly one organizer registration block and one participant registration block.',
    );
    expect(source).toContain(
      'Use reusable add-ons, registration questions, option descriptions, role eligibility, and organizer planning tips to capture repeatable event knowledge',
    );
    expect(source).toContain(
      '**Description** and **description for registered users**: Optional reusable',
    );
    expect(source).toContain(
      '**ESNcard discounted price**: Optional discounted pricing for tenants with the ESNcard discount provider enabled.',
    );
    expect(source).toContain(
      '**Selected roles**: The roles that are selected for this registration.',
    );
    expect(source).toContain(
      'Role selection also avoids duplicate entries by hiding already selected roles from the autocomplete list.',
    );
    expect(source).toContain(
      "throw new Error('Expected template docs autocomplete option to have text')",
    );
    expect(source).toContain(
      'Organizer planning tips**: Optional private organizer notes',
    );
    expect(source).toContain(
      'When **Enable Payment** is on, the price and tax-rate fields appear for that registration block.',
    );
    expect(source).toContain(
      'Add-ons can be free or paid, attached to either the participant or organizer registration option',
    );
    expect(source).toContain(
      'standalone before-event and during-event add-on sales are handled separately from this template setup flow',
    );
    expect(source).toContain(
      'Questions can include help text and can be marked as required.',
    );
    expect(source).toContain(
      'Event-side answer collection is handled separately from this template setup flow.',
    );
    expect(source).toContain('fillTemplateBasics');
    expect(source).toContain('createdTemplate.planningTips');
    expect(source).toContain('const savedTemplateDetailSurface =');
    expect(source).toContain('const templateOverviewSurface =');
    expect(source).toContain('const templateGeneralSettingsSurface =');
    expect(source).toContain('const simpleRegistrationSetupSurface =');
    expect(source).toContain('const templateAddOnFormSurface =');
    expect(source).toContain('const templateQuestionFormSurface =');
    expect(source).toContain("locator('app-template-list nav')");
    expect(source).toContain(
      "filter({ has: page.getByRole('link', { name: 'Create template' }) })",
    );
    expect(source).toContain('filter({ hasText: input.categoryTitle })');
    expect(source).toContain('const templateOverview =');
    expect(source).toContain(
      'Templates overview with seeded categories and create-template action',
    );
    expect(source).toContain("locator('app-template-general-form')");
    expect(source).toContain("locator('app-template-create form > div')");
    expect(source).toContain(
      "filter({ has: page.getByLabel('Template title') })",
    );
    expect(source).toContain(
      "filter({ has: page.getByLabel('Template Category') })",
    );
    expect(source).toContain(
      "filter({ has: page.getByLabel('Organizer planning tips') })",
    );
    expect(source).toContain('const generalSettingsForm =');
    expect(source).toContain('await expect(generalSettingsForm).toBeVisible()');
    expect(source).toContain('const simpleRegistrationSetup =');
    expect(source).toContain(
      "simpleRegistrationSetup.locator('app-template-registration-option-form')",
    );
    expect(source).toContain(').toHaveCount(2)');
    expect(source).toContain(
      "simpleRegistrationSetup.getByLabel('Registration option name')",
    );
    expect(source).toContain(
      'Simple registration setup with organizer and participant defaults',
    );
    expect(source).toContain("locator('app-template-addon-form')");
    expect(source).toContain("filter({ has: page.getByLabel('Add-on name') })");
    expect(source).toContain("filter({ has: page.getByLabel('Attach to') })");
    expect(source).toContain("filter({ hasText: 'Purchase timing' })");
    expect(source).toContain(
      'const addOnForm = templateAddOnFormSurface(page)',
    );
    expect(source).toContain("locator('app-template-question-form')");
    expect(source).toContain(
      "filter({ has: page.getByRole('textbox', { name: 'Question' }) })",
    );
    expect(source).toContain("filter({ has: page.getByLabel('Ask during') })");
    expect(source).toContain("filter({ hasText: 'Require an answer' })");
    expect(source).toContain(
      'const questionForm = templateQuestionFormSurface(page)',
    );
    expect(source).toContain("locator('app-template-details section')");
    expect(source).toContain('filter({ hasText: input.planningTips })');
    expect(source).toContain('filter({ hasText: input.addOnTitle })');
    expect(source).toContain('filter({ hasText: input.questionTitle })');
    expect(source).toContain('await expect(savedTemplateDetail).toBeVisible()');
    expect(source).toContain(
      'Saved template detail page with planning tips add-on and question',
    );
    expect(source).toContain('addonToTemplateRegistrationOptions');
    expect(source).toContain('templateRegistrationQuestions.findFirst');
    expect(source).toContain(
      'Expected template docs flow to persist the reusable add-on',
    );
    expect(source).not.toContain('bulk registration options');
    expect(source).not.toContain('multiple participant registration blocks');
    expect(source).not.toContain('public event planning tips');
    expect(source).not.toContain('roles can be selected more than once');
    expect(source).not.toContain(
      'ESNcard pricing is configured on events only',
    );
    expect(source).not.toContain('standalone add-on sales are configured here');
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    page.getByRole('heading', { name: templateTitle })",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    page.getByRole('link', { name: 'Create template' }),",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    page.locator('app-template-create form div').first(),",
    );
    expect(source).not.toContain(
      "const addOnForm = page.locator('app-template-addon-form').first();",
    );
    expect(source).not.toContain(
      "const questionForm = page.locator('app-template-question-form').first();",
    );
    expect(source).not.toContain(
      ".locator('div', { hasText: 'Simple Registration Setup' })",
    );
  });

  it('keeps template category docs backed by deterministic persistence checks', () => {
    const source = readSource(
      'tests/docs/template-categories/categories.doc.ts',
    );

    expect(source).toContain('Category docs ${seedDate.getTime()}');
    expect(source).toContain('categoryDialogSurface');
    expect(source).toContain(".locator('mat-dialog-container')");
    expect(source).toContain(
      "filter({ has: page.getByRole('heading', { name: title }) })",
    );
    expect(source).toContain(
      "filter({ has: page.getByRole('textbox', { name: 'Category title' }) })",
    );
    expect(source).toContain(
      "filter({ has: page.getByRole('button', { name: 'Save' }) })",
    );
    expect(source).toContain("'Create a new category'");
    expect(source).toContain("'Edit category'");
    expect(source).toContain(
      'Template category create dialog with title and save action',
    );
    expect(source).toContain('New template category row after saving');
    expect(source).toContain(
      'Template category edit dialog with existing title and save action',
    );
    expect(source).toContain('Updated template category row after renaming');
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.getByRole('textbox', { name: 'Category title' }),",
    );
    expect(source).not.toContain(
      "const categoryDialogForm = (page: Page): Locator =>\n  page.locator('mat-dialog-container form').first();",
    );
    expect(source).toContain(
      'Expected generated category docs to persist the category',
    );
    expect(source).toContain(
      'Expected generated category docs to update the category',
    );
    expect(source).toContain(
      'updatedCategory.title).toBe(updatedCategoryTitle)',
    );
    expect(source).toContain('.delete(schema.eventTemplateCategories)');
    expect(source).not.toContain("fill('Test category')");
    expect(source).not.toContain('Test category edited');
  });

  it('keeps registration docs aligned with unavailable states and transfer scope', () => {
    const source = readSource('tests/docs/events/register.doc.ts');

    expect(source).toContain(
      'When a participant option is full, registration changes to a distinct **Join waitlist** action',
    );
    expect(source).toContain(
      'Waitlisted participants can return to the event page and use **Leave waitlist** before the event starts.',
    );
    expect(source).toContain(
      'When the registration window is closed, participants can still read the event details, but the registration action is removed.',
    );
    expect(source).toContain(
      'This event is visible from the direct link, but your account is not eligible for the available registration options.',
    );
    expect(source).toContain(
      'Confirmed unpaid registrations can be transferred from the event page before check-in and before the event starts.',
    );
    expect(source).toContain(
      'Paid registration transfer or direct resale now starts with a transfer link/code. The replacement participant can start a Stripe Checkout registration from the link; after checkout succeeds, Evorto cancels the original registration and handles the source refund path. Public resale listings are outside the relaunch scope.',
    );
    expect(source).toContain('Review paid transfer/direct-resale state');
    expect(source).toContain(
      'Create a 24-hour transfer link and code for this paid registration. Share it with the replacement participant for direct transfer or resale; after replacement checkout succeeds, Evorto cancels this registration and handles the source refund path.',
    );
    expect(source).toContain(
      "page.getByRole('button', { name: 'Create transfer link' })",
    );
    expect(source).toContain(
      "page.getByRole('button', { name: 'Transfer registration' })",
    );
    expect(source).toContain(
      'Expected registration docs paid transfer state to persist the registration',
    );
    expect(source).toContain('Paid transfer code');
    expect(source).toContain(
      'QR email delivery is not part of the current relaunch flow.',
    );
    expect(source).toContain('seedRequiredRegistrationQuestion');
    expect(source).toContain(
      'Free registration cards can also offer registration-time add-ons and required questions.',
    );
    expect(source).toContain(
      'Question answers are stored with the registration for organizers.',
    );
    expect(source).toContain(
      'participantRegistrationCard.getByLabel(registrationQuestion.title)',
    );
    expect(source).toContain('replayCheckoutCompletedWebhook');
    expect(source).toContain(
      'Timed out waiting for replayed Stripe checkout webhook to be mirrored in the application database',
    );
    expect(source).toContain('const stripeCheckoutFormSurface =');
    expect(source).toContain(".locator('form')");
    expect(source).toContain("has: page.getByRole('button'");
    expect(source).toContain(
      'const checkoutForm = stripeCheckoutFormSurface(checkoutPage);',
    );
    expect(source).not.toContain(
      "const checkoutForm = checkoutPage.locator('form').first();",
    );
    expect(source).not.toContain("getByTestId('hosted-payment-submit-button')");
    expect(source).toContain('registration.questionAnswers');
    expect(source).toContain(
      'If that option asks required registration questions, participants must answer them before joining the waitlist.',
    );
    expect(source).toContain('waitlistRegistration.questionAnswers');
    expect(source).toContain(
      'Participants can leave the waitlist before the event starts, which cancels the waitlist registration and releases the waitlist position.',
    );
    expect(source).toContain('fullOptionAfterLeaving.waitlistSpots');
    expect(source).not.toContain('Register button stays available');
    expect(source).not.toContain('paid transfers are automatic');
    expect(source).not.toContain('resale is automatic');
    expect(source).not.toContain(
      'Paid registration transfer and resale are not automatic yet.',
    );
    expect(source).not.toContain(
      'Resale listing workflows are not available yet.',
    );
    expect(source).not.toContain('ticket QR code by email');
  });

  it('keeps event approval docs backed by deterministic lifecycle persistence checks', () => {
    const source = readSource('tests/docs/events/event-approval.doc.ts');

    expect(source).toContain('Approval Flow ${seedDate.getTime()}');
    expect(source).toContain('Expected generated approval docs event to exist');
    expect(source).toContain('const eventStatusSurface =');
    expect(source).toContain('const submitForReviewDialogSurface =');
    expect(source).toContain('const rejectEventDialogSurface =');
    expect(source).toContain(
      "has: page.getByRole('heading', { name: 'Submit Event for Review' })",
    );
    expect(source).toContain(
      'locked for editing until it is either approved or rejected',
    );
    expect(source).toContain(
      "has: page.getByRole('heading', { name: 'Review Event' })",
    );
    expect(source).toContain("has: page.getByLabel('Review Comment')");
    expect(source).toContain('Submit event for review confirmation dialog');
    expect(source).toContain(
      'Reject event dialog with required review comment field',
    );
    expect(source).toContain("eventStatusSurface(page, 'Pending Review')");
    expect(source).toContain('const rejectedStatusSurface =');
    expect(source).toContain('eventStatusSurface(page, [');
    expect(source).toContain(
      "expect((await readGeneratedEvent()).status).toBe('PENDING_REVIEW')",
    );
    expect(source).toContain("expect(rejectedEvent.status).toBe('REJECTED')");
    expect(source).toContain(
      'expect(rejectedEvent.statusComment).toBe(rejectionComment)',
    );
    expect(source).toContain("expect(approvedEvent.status).toBe('APPROVED')");
    expect(source).toContain('const publishedStatusSurface =');
    expect(source).toContain("eventStatusSurface(page, 'Published')");
    expect(source).toContain('final **Published** state');
    expect(source).toContain('Published event status');
    expect(source).not.toContain(
      'takeScreenshot(\n      testInfo,\n      page.getByText(rejectionComment).first(),',
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-event-status').first(),",
    );
    expect(source).not.toContain(
      "page\n      .locator('mat-dialog-container')\n      .first()\n      .getByRole('button', { name: 'Submit for Review' })",
    );
    expect(source).not.toContain('final published state');
    expect(source).toContain('.delete(schema.eventRegistrationOptions)');
    expect(source).toContain('.delete(schema.eventInstances)');
    expect(source).not.toContain(
      'Approval Flow ${seedDate.toISOString().slice(0, 10)}',
    );
  });

  it('keeps event-management docs aligned with scanner and organizer scope', () => {
    const source = readSource('tests/docs/events/event-management.doc.ts');

    expect(source).toContain(
      'The event management feature allows you to create and edit events, configure registration options, review listing state, inspect the organizer participant overview, and handle event receipts.',
    );
    expect(source).toContain(
      'Organizers check in attendees from the dedicated QR scanner.',
    );
    expect(source).toContain(
      'The scanned-registration page shows the attendee, event, registration option, ESNcard discount marker when applicable, guest check-in progress when guests are attached to the registration, and warnings for self-scan, future events, non-confirmed registrations, and already checked-in tickets.',
    );
    expect(source).toContain(
      'Confirming check-in records the registration check-in time and updates the checked-in count shown on the organizer overview.',
    );
    expect(source).toContain(
      'When a registration includes guests, the organizer chooses how many guests arrived with the attendee, and the checked-in count increases by the attendee plus the selected guests.',
    );
    expect(source).toContain(
      'page.goto(`/scan/registration/${scannerRegistrationId}`)',
    );
    expect(source).toContain("page.getByText('Includes 2 guests.')");
    expect(source).toContain(
      "page.getByRole('button', { name: 'Confirm 3 check-ins' })",
    );
    expect(source).toContain('const scannerGuestCheckInSurface =');
    expect(source).toContain("locator('app-handle-registration')");
    expect(source).toContain("filter({ hasText: 'Includes 2 guests.' })");
    expect(source).toContain(
      "filter({ hasText: '0 checked in, 2 remaining.' })",
    );
    expect(source).toContain(
      "filter({ has: page.getByLabel('Guests to check in now') })",
    );
    expect(source).toContain(
      'const scannerCheckIn = scannerGuestCheckInSurface',
    );
    expect(source).toContain('Scanned registration with guest check-in');
    expect(source).toContain("page.getByText('Check-in recorded')");
    expect(source).toContain('checkedInGuestCount: true');
    expect(source).toContain('checkedInSpots: initialCheckedInSpots + 3');
    expect(source).toContain('.update(eventRegistrationOptions)');
    expect(source).toContain('.set({ checkedInSpots: initialCheckedInSpots })');
    expect(source).toContain(
      "Organizers can also cancel a participant's confirmed registration from the organizer overview before check-in, which releases the confirmed spot and submits a Stripe refund when the paid registration has a stored Stripe payment reference.",
    );
    expect(source).toContain(
      'Older or manually seeded payment records still create a pending manual refund record for organizer follow-up.',
    );
    expect(source).toContain(
      'Paid registrations stay unavailable for direct organizer-assisted transfer and use participant-created transfer codes for replacement checkout and source refund handling.',
    );
    expect(source).toContain(
      'It does not currently include attendee export, attendee messaging, manual check-in controls outside QR scanning',
    );
    expect(source).toContain(
      'Role picker behavior: already selected roles are hidden from suggestions to avoid duplicate eligibility entries.',
    );
    expect(source).toContain('const eventListSurface =');
    expect(source).toContain("page.locator('app-event-list nav')");
    expect(source).toContain('const templateChoiceSurface =');
    expect(source).toContain("locator('app-template-list nav > div')");
    expect(source).toContain('const eventDetailsSurface =');
    expect(source).toContain("locator('router-outlet + * header')");
    expect(source).toContain('const registrationOptionSurface =');
    expect(source).toContain("locator('app-event-registration-option')");
    expect(source).toContain(
      "has: page.getByRole('heading', { name: input.optionTitle })",
    );
    expect(source).toContain("filter({ hasText: 'Participant option' })");
    expect(source).toContain('const createdEventId = page.url().match');
    expect(source).toContain(
      'Expected created event URL after event-management docs create flow',
    );
    expect(source).toContain('createdParticipantRegistrationOption');
    expect(source).toContain(
      'Expected created event "${templateName}" to have a participant registration option for docs screenshots',
    );
    expect(source).toContain(
      'const registrationOptions = registrationOptionSurface(page',
    );
    expect(source).not.toContain(
      "page.locator('app-event-registration-option').first()",
    );
    expect(source).toContain('const rolePickerSurface =');
    expect(source).toContain("locator('app-registration-option-form')");
    expect(source).toContain(
      'Expected seeded draft event for event-management role autocomplete docs',
    );
    expect(source).toContain(
      'Expected seeded event-management docs draft event "${draftEvent.title}" to have selected registration roles',
    );
    expect(source).toContain(
      'Expected seeded event-management docs draft event "${draftEvent.title}" to have an unselected role for autocomplete',
    );
    expect(source).toContain("page.getByPlaceholder('Add Role...')");
    expect(source).toContain('Event edit role picker duplicate prevention');
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    page.getByRole('heading', { level: 1, name: 'Events' })",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    page.getByRole('heading', {\n      level: 1,\n      name: 'Event templates',",
    );
    expect(source).not.toContain(
      'takeScreenshot(\n    testInfo,\n    page.locator(`h1:has-text("${templateName}")`)',
    );
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    page.getByRole('heading', { level: 2, name: 'Registration' })",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-handle-registration'),",
    );
    expect(source).not.toContain('manual check-in from the organizer overview');
    expect(source).not.toContain('managing attendees');
    expect(source).not.toContain('automatic refund controls are available');
    expect(source).not.toContain('paid registration transfer is available');
  });

  it('keeps role docs aligned with generated permission reference semantics', () => {
    const rolesSource = readSource('tests/docs/roles/roles.doc.ts');
    const permissionsSource = readSource(
      'tests/docs/roles/about-permissions.doc.ts',
    );

    expect(rolesSource).toContain(
      'Learn more at [about permissions](/docs/about-permissions).',
    );
    expect(rolesSource).toContain(
      'Permissions that are required by another permission are automatically included and shown as non-editable dependent permissions with the same admin-facing labels used in the permission reference.',
    );
    expect(rolesSource).toContain('Role docs ${seedDate.getTime()}');
    expect(rolesSource).toContain('const readOnlyUserListSurface =');
    expect(rolesSource).toContain("locator('app-user-list')");
    expect(rolesSource).toContain(
      'Existing-user role assignment is deferred for relaunch.',
    );
    expect(rolesSource).toContain(
      "getByRole('cell', {\n        exact: true,\n        name: 'admin@evorto.app',",
    );
    expect(rolesSource).toContain('const userList = readOnlyUserListSurface');
    expect(rolesSource).toContain('Read-only tenant user list');
    expect(rolesSource).toContain('const roleListCreateSurface =');
    expect(rolesSource).toContain("locator('app-role-list')");
    expect(rolesSource).toContain(
      "has: page.getByRole('heading', {\n        name: 'User roles',",
    );
    expect(rolesSource).toContain(
      "filter({ has: page.getByRole('link', { name: 'Create role' }) })",
    );
    expect(rolesSource).toContain('const roleListCreateAction =');
    expect(rolesSource).toContain(
      'User roles page with the create-role action highlighted',
    );
    expect(rolesSource).toContain(
      'Saved role detail page with dependent permissions visible',
    );
    expect(rolesSource).toContain('const roleFormPermissionGroupSurface =');
    expect(rolesSource).toContain("locator('app-role-form div')");
    expect(rolesSource).toContain(
      "getByRole('checkbox', { exact: true, name: 'Events' })",
    );
    expect(rolesSource).toContain('Includes: View templates');
    expect(rolesSource).toContain('const savedRoleDetailSurface =');
    expect(rolesSource).toContain("locator('app-role-details div')");
    expect(rolesSource).toContain('filter({ hasText: roleDescription })');
    expect(rolesSource).toContain("filter({ hasText: 'Create events' })");
    expect(rolesSource).toContain("filter({ hasText: 'View templates' })");
    expect(rolesSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.getByRole('checkbox', { exact: true, name: 'Events' })",
    );
    expect(rolesSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.getByRole('heading', { name: roleName })",
    );
    expect(rolesSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-user-list')",
    );
    expect(rolesSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.getByRole('link', { name: 'Create role' })",
    );
    expect(rolesSource).toContain(
      "throw new Error('Expected generated roles doc to persist the role')",
    );
    expect(rolesSource).toContain(
      "createdRole.permissions).toContain('events:create')",
    );
    expect(rolesSource).toContain(
      "createdRole.permissions).toContain('templates:view')",
    );
    expect(rolesSource).toContain('.delete(schema.roles)');
    expect(permissionsSource).toContain(
      'Permissions are tenant-scoped capabilities assigned through roles.',
    );
    expect(permissionsSource).toContain(
      'Wildcard permissions such as \\`events:*\\` grant the permissions in that group.',
    );
    expect(permissionsSource).toContain(
      'Some permissions also include dependent permissions so the user can reach the screens needed to use the parent capability.',
    );
    expect(permissionsSource).toContain('PERMISSION_GROUPS');
    expect(permissionsSource).toContain('PERMISSION_DEPENDENCIES');
    expect(permissionsSource).not.toMatch(/global-admin|global admin/i);
    expect(permissionsSource).not.toContain('Global admin access is a role');
    expect(permissionsSource).not.toContain('tenant roles grant global admin');
  });

  it('keeps ESN discount docs aligned with provider-error and write-guard behavior', () => {
    const source = readSource('tests/docs/profile/discounts.doc.ts');

    expect(source).toContain('esnCardStatusLabel');
    expect(source).toContain('esnCardActionLabel');
    expect(source).toContain('esnCardActionDisabled');
    expect(source).toContain('esnCardSaveDisabled');
    expect(source).toContain('esnCardSubmitPayloadFromIdentifier');
    expect(source).toContain('esnCardMutationErrorMessage');
    expect(source).toContain(
      'The profile discount-card form stores one ESN card per user and trims the card number before validation.',
    );
    expect(source).toContain(
      'Save, refresh, and remove stay disabled while any ESNcard write is pending',
    );
    expect(source).toContain(
      'Provider outages are not treated as invalid cards.',
    );
    expect(source).toContain(
      'Evorto leaves the stored ESN card unchanged so the user can retry later.',
    );
    expect(source).toContain("page.goto('/profile#discounts')");
    expect(source).toContain(
      "page.getByRole('heading', { level: 2, name: 'Discount Cards' })",
    );
    expect(source).toContain('const esnDiscountCardSurface =');
    expect(source).toContain("locator('app-user-profile div')");
    expect(source).toContain('filter({ hasText: input.identifier })');
    expect(source).toContain("filter({ hasText: 'Status: Verified' })");
    expect(source).toContain("filter({ hasText: 'Refresh' })");
    expect(source).toContain("filter({ hasText: 'Remove' })");
    expect(source).toContain('const seededDiscountCard =');
    expect(source).toContain('await expect(seededDiscountCard).toBeVisible()');
    expect(source).toContain('const esnDiscountFormSurface =');
    expect(source).toContain("locator('app-user-profile section')");
    expect(source).toContain(
      "has: page.getByRole('heading', { level: 2, name: 'Discount Cards' })",
    );
    expect(source).toContain(
      "has: page.getByRole('button', { name: 'Save ESN card' })",
    );
    expect(source).toContain('const providerOutageForm =');
    expect(source).toContain('const invalidCardForm =');
    expect(source).toContain('unchangedSeededEsnCard');
    expect(source).toContain(
      "page.getByRole('button', { name: 'Save ESN card' })",
    );
    expect(source).toContain(
      'Discount card form showing invalid ESN card validation',
    );
    expect(source).toContain('TESTESNDOWN');
    expect(source).toContain(
      'Discount card provider outage keeps the stored card unchanged',
    );
    expect(source).toContain('providerOutageSeededEsnCard');
    expect(source).toContain('ESNcard validation provider is unavailable');
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    page.getByRole('heading', { level: 2, name: 'Discount Cards' })",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    page.getByText('Could not validate ESN card right now. Try again later.'),",
    );
    expect(source).not.toContain(
      'takeScreenshot(\n    testInfo,\n    page.getByText(/Enter a valid ESN card number/),',
    );
    expect(source).not.toContain('provider outages mark the card invalid');
    expect(source).not.toContain('overlap ESNcard writes');
    expect(source).not.toContain('stores the card number without trimming');
  });
});
