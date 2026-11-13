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

const renderTemplateList = async () => {
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
                queryFn: () => Promise.resolve(categories),
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
  await vi.waitFor(async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelector('input[type="search"]')).not.toBeNull();
  });
  return { fixture, root };
};

const searchInput = (root: HTMLElement): HTMLInputElement => {
  const input = root.querySelector('input[type="search"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new TypeError('Expected search input');
  }
  return input;
};

const type = async (
  fixture: ComponentFixture<TemplateListComponent>,
  root: HTMLElement,
  value: string,
) => {
  const input = searchInput(root);
  input.value = value;
  input.dispatchEvent(new Event('input'));
  fixture.detectChanges();
  await fixture.whenStable();
};

const headings = (root: HTMLElement) =>
  [...root.querySelectorAll(':scope nav h2')].map((heading) =>
    heading.textContent.trim(),
  );

describe('TemplateListComponent search', () => {
  it('labels the field and lists every category before searching', async () => {
    const { root } = await renderTemplateList();

    expect(root.textContent).toContain('Search templates');
    expect(headings(root)).toEqual(['Trips', 'Parties', 'Workshops']);
    expect(root.querySelector('button[aria-label="Clear search"]')).toBeNull();
  });

  it('shows only matching templates and hides categories without matches', async () => {
    const { fixture, root } = await renderTemplateList();

    await type(fixture, root, 'augsburg');

    expect(headings(root)).toEqual(['Trips']);
    expect(root.textContent).toContain('Augsburg Trip');
    expect(root.textContent).not.toContain('Mountain Hike');
    expect(root.textContent).not.toContain('Pub Crawl');
  });

  it('explains when no template matches', async () => {
    const { fixture, root } = await renderTemplateList();

    await type(fixture, root, '  zzz ');

    const status = root.querySelector('[role="status"]');
    expect(status?.textContent).toContain('No matching templates');
    expect(status?.textContent).toContain('“zzz”');
    expect(headings(root)).toEqual(['No matching templates']);
  });

  it('clears the search, restores the list and refocuses the field', async () => {
    const { fixture, root } = await renderTemplateList();

    await type(fixture, root, 'pub');
    expect(headings(root)).toEqual(['Parties']);
    const clear = root.querySelector('button[aria-label="Clear search"]');
    if (!(clear instanceof HTMLButtonElement)) {
      throw new TypeError('Expected clear button');
    }

    clear.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(headings(root)).toEqual(['Trips', 'Parties', 'Workshops']);
    expect(searchInput(root).value).toBe('');
    expect(document.activeElement).toBe(searchInput(root));
    expect(root.querySelector('button[aria-label="Clear search"]')).toBeNull();
  });
});
