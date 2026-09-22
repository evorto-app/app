import { describe, expect, it } from 'vitest';

import {
  generatedGuideLanguageViolations,
  generatedGuideLevelOneHeadingViolations,
} from './generated-docs-language';

describe('generated documentation language', () => {
  it('rejects every level-one heading form outside fenced examples', () => {
    expect(
      generatedGuideLevelOneHeadingViolations(
        [
          '# ATX title',
          '',
          'Setext title',
          '===',
          '',
          '<h1>HTML title</h1>',
        ].join('\n'),
      ),
    ).toEqual(['# ATX title', 'Setext title\n===', '<h1>HTML title</h1>']);

    expect(
      generatedGuideLevelOneHeadingViolations(
        [
          '## Authored section',
          '',
          '```md',
          '# Example title',
          'Example Setext title',
          '===',
          '<h1>Example HTML title</h1>',
          '```',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('rejects storage-oriented record wording without blocking a real action', () => {
    expect(
      generatedGuideLanguageViolations(
        'The confirmed ticket remains the reliable record.',
      ),
    ).toEqual(['reliable record']);
    expect(
      generatedGuideLanguageViolations(
        'Select Record reimbursement after sending the money.',
      ),
    ).toEqual([]);
  });

  it('rejects technical publication and browser terminology', () => {
    expect(
      generatedGuideLanguageViolations(
        'A relaunch workflow used an HTTPS URL, a Checkout session, an audit log, an operator reason, and a local walkthrough after a request failure and settlement.',
      ),
    ).toEqual([
      'relaunch',
      'workflow',
      'HTTPS',
      'URL',
      'Checkout session',
      'audit log',
      'operator reason',
      'local walkthrough',
      'request failure',
      'settlement',
    ]);
  });
});
