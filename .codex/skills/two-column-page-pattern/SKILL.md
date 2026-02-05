---
name: two-column-page-pattern
description: Implement Evorto two-column list/detail page layout with responsive grid, mobile list hiding when the detail outlet is active, and routerLinkActive styling. Use when building pages like admin overview, events list/detail, or any list-detail page pattern.
---

# Two Column Page Pattern

## Overview

Use this pattern to build Evorto list-detail pages with a left navigation/list column and a right detail outlet. On mobile, the list hides when a detail route is active; on desktop, both columns remain visible.

## Quick Start

Use this structure as the default template:

```html
<div class="grid grid-cols-1 lg:grid-cols-[300px_1fr] lg:gap-4 lg:p-4">
  <div>
    <div
      class="mb-4 {{ outletActive() ? 'hidden' : 'flex' }} lg:flex w-full flex-row items-center gap-2"
    >
      <h1 class="title-large">Title</h1>
      <div class="grow"></div>
      <!-- optional actions -->
    </div>

    <nav class="{{ outletActive() ? 'hidden' : 'flex' }} lg:flex flex-col gap-4">
      <a
        routerLink="child-route"
        class="bg-surface text-on-surface rounded-2xl p-4"
        routerLinkActive="bg-secondary-container! text-on-secondary-container!"
      >
        <!-- list item content -->
      </a>
    </nav>
  </div>

  <div>
    <router-outlet
      (activate)="outletActive.set(true)"
      (deactivate)="outletActive.set(false)"
    ></router-outlet>
  </div>
</div>
```

## Implementation Steps

1. Create a signal in the component TS for outlet state:

```ts
outletActive = signal(false);
```

2. Wrap the page in a responsive grid:
- `grid grid-cols-1` for mobile
- `lg:grid-cols-[300px_1fr]` (or `lg:grid-cols-[400px_1fr]`) for desktop
- `lg:gap-4 lg:p-4` for spacing

3. Left column (list/nav):
- Use the `outletActive()` check to hide header and list on mobile.
- Keep the `lg:flex` override so the list stays visible on desktop.

4. Right column (detail):
- Use a `router-outlet` and toggle `outletActive` on `(activate)` and `(deactivate)`.

5. Active state styling:
- Apply `routerLinkActive="bg-secondary-container! text-on-secondary-container!"` to list items.

## Optional Enhancements

- If lists get long, add `lg:h-full lg:overflow-y-auto` to the left column container.
- To align with other list/detail pages, keep list items as `bg-surface text-on-surface rounded-2xl`.
- Keep list and header layout consistent with admin and events pages.
