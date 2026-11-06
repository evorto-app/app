import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { HubResources } from './hub-resources';
const decode = Schema.decodeUnknownSync(HubResources);
describe('hub resource input', () => {
  it('accepts ordered web and email resources', () => {
    const resources = [
      {
        href: 'https://drive.google.com/',
        icon: { iconColor: 0, iconName: 'folder' },
        label: 'Documents',
      },
      {
        href: 'mailto:team@example.org',
        icon: { iconColor: 0, iconName: 'email' },
        label: 'Contact',
      },
    ];
    expect(decode(resources)).toEqual(resources);
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///private/secret',
    'https://user:password@example.org',
    'https://example.org\n',
    '/internal',
    'https:community.example.org',
    'https:/community.example.org',
    'http:community.example.org',
  ])('rejects unsafe or ambiguous destinations: %s', (href) => {
    expect(() =>
      decode([
        { href, icon: { iconColor: 0, iconName: 'link' }, label: 'Resource' },
      ]),
    ).toThrow();
  });
  it('rejects blank labels, invalid icon names, and oversized lists', () => {
    expect(() =>
      decode([
        {
          href: 'https://example.org',
          icon: { iconColor: 0, iconName: 'link' },
          label: ' ',
        },
      ]),
    ).toThrow();
    expect(() =>
      decode([
        {
          href: 'https://example.org',
          icon: { iconColor: 0, iconName: '../script' },
          label: 'Name',
        },
      ]),
    ).toThrow();
    expect(() =>
      decode(
        Array.from({ length: 31 }, () => ({
          href: 'https://example.org',
          icon: { iconColor: 0, iconName: 'link' },
          label: 'Name',
        })),
      ),
    ).toThrow();
  });
});
