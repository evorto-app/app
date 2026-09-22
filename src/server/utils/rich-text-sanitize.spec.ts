import { describe, expect, it } from '@effect/vitest';

import { richTextToPlainText } from './rich-text-sanitize';

describe('audit description plain text', () => {
  it('decodes literal text once after removing executable markup', () => {
    expect(
      richTextToPlainText(
        '<p>Food &amp; drinks &lt;bring ID&gt;</p><script>hidden()</script>',
      ),
    ).toBe('Food & drinks <bring ID>');
    expect(
      richTextToPlainText('<p>&amp;lt;literal&amp;gt; &#60;tag&#62;</p>'),
    ).toBe('&lt;literal&gt; <tag>');
  });

  it('keeps readable boundaries and decodes entities without exposing markup', () => {
    expect(
      richTextToPlainText(
        '<p>Welcome&nbsp;<strong>back</strong>.</p><ul><li>Bring ID</li><li>Arrive early</li></ul>',
      ),
    ).toBe('Welcome back. Bring ID Arrive early');
  });
});
