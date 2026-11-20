import type { TemplatesByCategoryRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { createRpcQueryKey } from '@heddendorp/effect-angular-query';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { describe, expect, it, vi } from 'vitest';

import { APP_RPC_CLIENT } from '../../core/effect-rpc-angular-client';
import { PermissionsService } from '../../core/permissions.service';
import { TemplateListComponent } from './template-list.component';
import { filterTemplateCategories } from './template-list.filter';

const icon = { iconColor: 0, iconName: 'trip:fluent' } as const;

const categories = [
  {
    icon,
    id: 'category-trips',
    templates: [
      { icon, id: 'template-augsburg', title: 'Augsburg Trip' },
      { icon, id: 'template-hike', title: 'Mountain Hike' },
    ],
    title: 'Trips',
  },
  {
    icon,
    id: 'category-parties',
    templates: [{ icon, id: 'template-pub', title: 'Pub Crawl' }],
    title: 'Parties',
  },
  {
    icon,
    id: 'category-empty',
    templates: [],
    title: 'Workshops',
  },
] as const satisfies readonly TemplatesByCategoryRecord[];

describe('filterTemplateCategories', () => {
  it('returns every category for blank and whitespace-only searches', () => {
    expect(filterTemplateCategories(categories, '')).toEqual(categories);
    expect(filterTemplateCategories(categories, ' '.repeat(3))).toEqual(
      categories,
    );
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    expect(filterTemplateCategories(categories, '  TRIP ')).toEqual([
      {
        ...categories[0],
        templates: [categories[0].templates[0]],
      },
    ]);
  });

  it('matches partial text inside a title', () => {
    const result = filterTemplateCategories(categories, 'untain');

    expect(result.map((category) => category.id)).toEqual(['category-trips']);
    expect(result[0]?.templates.map((template) => template.title)).toEqual([
      'Mountain Hike',
    ]);
  });

  it('drops categories without matches and keeps the remaining order', () => {
    const result = filterTemplateCategories(categories, 'p');

    expect(result.map((category) => category.id)).toEqual([
      'category-trips',
      'category-parties',
    ]);
    expect(result[0]?.templates.map((template) => template.title)).toEqual([
      'Augsburg Trip',
    ]);
    expect(result[1]?.templates.map((template) => template.title)).toEqual([
      'Pub Crawl',
    ]);
    expect(filterTemplateCategories(categories, 'nothing')).toEqual([]);
  });

  it('does not mutate its input', () => {
    const input = structuredClone(categories);
    const snapshot = structuredClone(categories);

    filterTemplateCategories(input, 'trip');

    expect(input).toEqual(snapshot);
  });
});

type TemplateQueryFn = () => Promise<readonly TemplatesByCategoryRecord[]>;

const createTemplateList = async (queryFn: TemplateQueryFn) => {
  await TestBed.configureTestingModule({
    imports: [TemplateListComponent],
    providers: [
      provideRouter([]),
      provideTanStackQuery(
        new QueryClient({
          defaultOptions: { queries: { gcTime: 0, retry: false } },
        }),
      ),
      {
        provide: PermissionsService,
        useValue: {
          hasPermission: () => signal(false).asReadonly(),
          hasPermissionSync: () => false,
        },
      },
      {
        provide: APP_RPC_CLIENT,
        useValue: {
          templates: {
            groupedByCategory: {
              queryOptions: () => ({
                queryFn,
                queryKey: createRpcQueryKey(
                  ['templates', 'groupedByCategory'],
                  { keyPrefix: 'rpc', type: 'query' },
                ),
              }),
            },
          },
        },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(TemplateListComponent);
  const root: unknown = fixture.nativeElement;
  if (!(root instanceof HTMLElement)) {
    throw new TypeError('Expected template list element');
  }
  return { fixture, root };
};

const renderTemplateList = async () => {
  const { fixture, root } = await createTemplateList(() =>
    Promise.resolve(categories),
  );
  await vi.waitFor(async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.textContent).toContain('Trips');
  });
  return { fixture, root };
};

const settle = async (fixture: ComponentFixture<TemplateListComponent>) => {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
};

const searchButton = (root: HTMLElement): HTMLButtonElement | null => {
  const button = root.querySelector('button[aria-label="Search templates"]');
  return button instanceof HTMLButtonElement ? button : null;
};

const searchInput = (root: HTMLElement): HTMLInputElement | null => {
  const input = root.querySelector('input[type="search"]');
  return input instanceof HTMLInputElement ? input : null;
};

const requireElement = <T extends HTMLElement>(element: null | T): T => {
  if (!element) {
    throw new TypeError('Expected element');
  }
  return element;
};

const openSearch = async (
  fixture: ComponentFixture<TemplateListComponent>,
  root: HTMLElement,
) => {
  requireElement(searchButton(root)).click();
  await settle(fixture);
};

const type = async (
  fixture: ComponentFixture<TemplateListComponent>,
  root: HTMLElement,
  value: string,
) => {
  const input = requireElement(searchInput(root));
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await settle(fixture);
};

const headings = (root: HTMLElement) =>
  [...root.querySelectorAll(':scope nav h2')].map((heading) =>
    heading.textContent.trim(),
  );

const liveRegionText = (root: HTMLElement) =>
  root.querySelector('[role="status"]')?.textContent.trim();

const pageTitle = (root: HTMLElement) => root.querySelector('h1');

const categoriesLink = (root: HTMLElement) =>
  [...root.querySelectorAll('a')].find((link) =>
    link.textContent.includes('View categories'),
  );

const expectBrowsing = (root: HTMLElement) => {
  expect(pageTitle(root)?.textContent).toContain('Event templates');
  expect(categoriesLink(root)).toBeDefined();
  expect(searchInput(root)).toBeNull();
  expect(headings(root)).toEqual(['Trips', 'Parties', 'Workshops']);
  expect(liveRegionText(root)).toBe('');
};

describe('TemplateListComponent search', () => {
  it('shows a search button instead of a field while browsing', async () => {
    const { root } = await renderTemplateList();

    expect(searchButton(root)).not.toBeNull();
    expectBrowsing(root);
    expect(root.querySelector('[role="status"]')).not.toBeNull();
  });

  it('opens a focused field in place of the title and actions', async () => {
    const { fixture, root } = await renderTemplateList();

    await openSearch(fixture, root);

    const input = requireElement(searchInput(root));
    expect(document.activeElement).toBe(input);
    expect(root.textContent).toContain('Search templates');
    expect(pageTitle(root)).toBeNull();
    expect(categoriesLink(root)).toBeUndefined();
    expect(headings(root)).toEqual(['Trips', 'Parties', 'Workshops']);
  });

  it('shows only matching templates and announces the count', async () => {
    const { fixture, root } = await renderTemplateList();
    await openSearch(fixture, root);

    await type(fixture, root, 'augsburg');
    expect(headings(root)).toEqual(['Trips']);
    expect(root.textContent).toContain('Augsburg Trip');
    expect(root.textContent).not.toContain('Mountain Hike');
    expect(root.textContent).not.toContain('Pub Crawl');
    expect(liveRegionText(root)).toBe('1 matching template');

    await type(fixture, root, 'p');
    expect(liveRegionText(root)).toBe('2 matching templates');

    await type(fixture, root, 'zzz');
    expect(liveRegionText(root)).toBe('No matching templates');

    await type(fixture, root, '');
    expect(liveRegionText(root)).toBe('');
  });

  it('explains when no template matches', async () => {
    const { fixture, root } = await renderTemplateList();
    await openSearch(fixture, root);

    await type(fixture, root, '  zzz ');

    const emptyState = [...root.querySelectorAll(':scope nav div')].find(
      (element) => element.textContent.includes('No matching templates'),
    );
    expect(emptyState?.getAttribute('role')).toBeNull();
    expect(emptyState?.textContent).toContain('“zzz”');
    expect(headings(root)).toEqual(['No matching templates']);
  });

  it('clears the query and keeps the field open and focused', async () => {
    const { fixture, root } = await renderTemplateList();
    await openSearch(fixture, root);
    await type(fixture, root, 'pub');
    expect(headings(root)).toEqual(['Parties']);

    const clear = root.querySelector('button[aria-label="Clear search"]');
    requireElement(clear instanceof HTMLButtonElement ? clear : null).click();
    await settle(fixture);

    const input = requireElement(searchInput(root));
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(headings(root)).toEqual(['Trips', 'Parties', 'Workshops']);
    expect(root.querySelector('button[aria-label="Clear search"]')).toBeNull();
    expect(pageTitle(root)).toBeNull();
  });

  it('closes with the back button and restores the header and focus', async () => {
    const { fixture, root } = await renderTemplateList();
    await openSearch(fixture, root);
    await type(fixture, root, 'pub');

    const close = root.querySelector('button[aria-label="Close search"]');
    requireElement(close instanceof HTMLButtonElement ? close : null).click();
    await settle(fixture);

    expectBrowsing(root);
    expect(document.activeElement).toBe(searchButton(root));
  });

  it('closes with Escape and restores the header and focus', async () => {
    const { fixture, root } = await renderTemplateList();
    await openSearch(fixture, root);
    await type(fixture, root, 'pub');

    requireElement(searchInput(root)).dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }),
    );
    await settle(fixture);

    expectBrowsing(root);
    expect(document.activeElement).toBe(searchButton(root));
  });

  it('ignores Escape during IME composition', async () => {
    const { fixture, root } = await renderTemplateList();
    await openSearch(fixture, root);

    requireElement(searchInput(root)).dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        isComposing: true,
        key: 'Escape',
      }),
    );
    await settle(fixture);

    expect(searchInput(root)).not.toBeNull();
    expect(pageTitle(root)).toBeNull();
  });

  it('renders the search button with an empty live region while loading', async () => {
    const { fixture, root } = await createTemplateList(
      () =>
        new Promise<never>(() => {
          // Keep the query pending for the duration of this test.
        }),
    );
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(searchButton(root)).not.toBeNull();
    expect(liveRegionText(root)).toBe('');
  });
});
