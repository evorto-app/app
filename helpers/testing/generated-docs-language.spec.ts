import { describe, expect, it } from 'vitest';

import { generatedGuideLevelOneHeadingViolations } from './generated-docs-language';

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
});
