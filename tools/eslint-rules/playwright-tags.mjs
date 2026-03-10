/*
 * This plugin enforces the repo's Playwright test-title metadata convention.
 *
 * What it checks:
 * - Any `test(...)` or `test.only/skip/fixme/slow/fail(...)` call under
 *   `tests/**` must have a static title string.
 * - Every such title must include `@track(<track_id>)`.
 * - Tests under `tests/docs/**` must also include `@doc(<id>)`.
 * - All other tests under `tests/**` must include `@req(<id>)`.
 *
 * How it works:
 * - It inspects Playwright call expressions directly in the ESTree AST.
 * - It only validates static string and static template literal titles so the
 *   rule remains deterministic and avoids guessing dynamic values.
 * - File-path classification decides whether a test is treated as a doc test.
 *
 * Why it lives in a standalone file:
 * - The ESLint flat config stays declarative and readable.
 * - The rule logic can evolve independently without turning the main config
 *   into a large block of embedded AST code.
 */

const PLAYWRIGHT_TEST_CALL_MODIFIERS = new Set([
  "fail",
  "fixme",
  "only",
  "skip",
  "slow",
]);

function isPlaywrightTestCall(callee) {
  if (callee.type === "Identifier") {
    return callee.name === "test";
  }

  if (callee.type === "MemberExpression") {
    return (
      callee.object.type === "Identifier" &&
      callee.object.name === "test" &&
      callee.property.type === "Identifier" &&
      PLAYWRIGHT_TEST_CALL_MODIFIERS.has(callee.property.name)
    );
  }

  return false;
}

function getStaticTitle(firstArgument) {
  if (!firstArgument) {
    return undefined;
  }

  if (
    firstArgument.type === "Literal" &&
    typeof firstArgument.value === "string"
  ) {
    return firstArgument.value;
  }

  if (
    firstArgument.type === "TemplateLiteral" &&
    firstArgument.expressions.length === 0
  ) {
    return firstArgument.quasis[0]?.value.cooked;
  }

  return undefined;
}

function isDocTestFile(fileName) {
  const normalizedFileName = fileName.replaceAll("\\", "/");
  return (
    normalizedFileName.startsWith("tests/docs/") ||
    normalizedFileName.includes("/tests/docs/")
  );
}

export const playwrightTagPlugin = {
  rules: {
    "require-test-tags": {
      meta: {
        docs: {
          description:
            "Require @track + @req/@doc tags in Playwright test titles under tests/**",
        },
        messages: {
          missingDocTag:
            "Playwright doc tests under tests/docs/** must include @doc(<id>) in the test title.",
          missingReqTag:
            "Playwright non-doc tests under tests/** must include @req(<id>) in the test title.",
          missingTrackTag:
            "Playwright tests under tests/** must include @track(<track_id>) in the test title.",
        },
        schema: [],
        type: "problem",
      },
      create(context) {
        const trackPattern = /@track\([^()]+\)/;
        const reqPattern = /@req\([^()]+\)/;
        const docPattern = /@doc\([^()]+\)/;
        const docTest = isDocTestFile(context.filename);

        return {
          CallExpression(node) {
            if (!isPlaywrightTestCall(node.callee)) {
              return;
            }

            const title = getStaticTitle(node.arguments[0]);
            if (!title) {
              return;
            }

            if (!trackPattern.test(title)) {
              context.report({ messageId: "missingTrackTag", node });
            }

            if (docTest) {
              if (!docPattern.test(title)) {
                context.report({ messageId: "missingDocTag", node });
              }
              return;
            }

            if (!reqPattern.test(title)) {
              context.report({ messageId: "missingReqTag", node });
            }
          },
        };
      },
    },
  },
};
