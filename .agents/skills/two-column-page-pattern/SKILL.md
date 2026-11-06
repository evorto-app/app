---
name: two-column-page-pattern
description: Implement Evorto two-column list/detail or navigation/detail pages with shared layout slots, fixed left headers, independent desktop pane scrolling where needed, and mobile detail navigation.
---

# Two-column page pattern

Use `TwoColumnLayoutComponent` from
`src/app/shared/components/two-column-layout/two-column-layout.component.ts`.
Read its adjacent README for sizing and scroll behavior. Do not repeat the grid,
mobile sidebar hiding, or pane padding in page templates.

```html
<app-two-column-layout
  [detailActive]="outletActive()"
  [independentScroll]="true"
  sidebarWidth="400px"
  sidebarLabel="Event list"
  detailLabel="Selected event"
>
  <div twoColumnHeader class="flex items-center gap-2">
    <h1 class="title-large">Events</h1>
    <!-- Page actions -->
  </div>
  <nav twoColumnSidebar class="flex flex-col gap-2">
    <!-- Existing links with routerLinkActive styling -->
  </nav>
  <div twoColumnDetail>
    <router-outlet
      (activate)="outletActive.set(true)"
      (deactivate)="outletActive.set(false)"
    />
  </div>
</app-two-column-layout>
```

- Keep outlet activation state in the owning page, using `signal(false)`.
- Events/templates use `independentScroll`; their page host needs
  `lg:h-full lg:min-h-0`. The app shell reserves the organization footer's space.
  Do not introduce another viewport height.
- Settings/profile pages use the default document scrolling and sticky sidebar.
- The left header stays visible above the scrolling list. Detail top padding
  belongs inside its scrolling area and scrolls out of view.
- Optional `twoColumnFooter` content stays below the sidebar list, for contextual
  links or actions. Global organization/legal links remain in the app footer.
- Keep existing `routerLinkActive` semantic colors and permission directives in
  projected page content.
- Verify independent desktop scrolling, fixed left header, footer placement, and
  mobile list/detail navigation through Browser and behavior-focused Playwright.
