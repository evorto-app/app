import { describe, expect, it } from '@effect/vitest';

import {
  isMeaningfulRichTextHtml,
  richTextToPlainText,
  sanitizeOptionalRichTextHtml,
  sanitizeRichTextHtml,
} from './rich-text-sanitize';

describe('rich-text sanitization', () => {
  it('turns formatted descriptions into readable plain text', () => {
    expect(
      richTextToPlainText(
        '<p>Welcome&nbsp;<strong>back</strong>.</p><ul><li>Bring ID</li><li>Arrive early</li></ul>',
      ),
    ).toBe('Welcome back. Bring ID Arrive early');
  });

  it('keeps supported text, links, lists, and tables', () => {
    const sanitized = sanitizeRichTextHtml(
      '<h2>Welcome</h2><a href="https://example.com">Details</a><ul><li>Bring ID</li></ul><table><tbody><tr><td>18:00</td></tr></tbody></table>',
    );

    expect(sanitized).toContain('<h2>Welcome</h2>');
    expect(sanitized).toContain(
      '<a href="https://example.com" rel="noopener noreferrer nofollow" target="_blank">Details</a>',
    );
    expect(sanitized).toContain('<ul><li>Bring ID</li></ul>');
    expect(sanitized).toContain(
      '<table><tbody><tr><td>18:00</td></tr></tbody></table>',
    );
  });

  it('removes remote and temporary images instead of preserving tracking requests or upload state', () => {
    expect(
      sanitizeRichTextHtml(
        '<p>Visible text</p><img src="https://tracker.example/pixel?id=member" alt="tracker"><img src="blob:pending-upload">',
      ),
    ).toBe('<p>Visible text</p>');
    expect(
      sanitizeOptionalRichTextHtml(
        '<img src="https://tracker.example/pixel?id=member">',
      ),
    ).toBeNull();
    expect(
      sanitizeOptionalRichTextHtml('<img src="blob:pending-upload">'),
    ).toBeNull();
  });

  it('removes executable markup and unsafe link protocols', () => {
    expect(
      sanitizeRichTextHtml(
        '<script>alert(1)</script><p onclick="alert(2)">Safe</p><a href="javascript:alert(3)">Link</a>',
      ),
    ).toBe(
      '<p>Safe</p><a rel="noopener noreferrer nofollow" target="_blank">Link</a>',
    );
  });

  it('treats supported structural nodes as meaningful without requiring text', () => {
    expect(isMeaningfulRichTextHtml('<hr />')).toBe(true);
    expect(
      sanitizeOptionalRichTextHtml(
        '<table><tbody><tr><td></td></tr></tbody></table>',
      ),
    ).not.toBeNull();
  });
});
