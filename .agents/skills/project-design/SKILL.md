---
name: project-design
description: Project-specific UI and styling guidance for Evorto, including when to use viewport queries versus Tailwind v4 container queries.
---

# Project Design

## Container Queries

Use viewport queries for page-level layout changes and container queries for component-level adaptation.

### Rules

1. Use viewport breakpoints (`sm:`, `md:`, `lg:`) for global structure (page grids, shell layout, top-level navigation behavior).
2. Use container queries (`@container` and `@sm:`, `@md:`, `@lg:`) for reusable components that should adapt to their parent width.
3. Mark only intentional component boundaries with `@container`; avoid deep or unnecessary nested containers.
4. Keep a predictable model: layout responds to viewport, components respond to container.
5. Build for modern browsers and keep components readable if container query variants do not apply.

### Tailwind v4 Pattern

```html
<section class="@container">
  <div class="grid gap-4 @lg:grid-cols-2">
    <article class="rounded-2xl p-4">
      <h3 class="text-base @md:text-lg">Card title</h3>
      <p class="@sm:line-clamp-3">Component content adapts to container width.</p>
    </article>
  </div>
</section>
```

### Project Notes

- Prefer simple, explicit breakpoints over many tiny threshold tweaks.
- Document non-obvious container-query behavior in the feature README when it affects UX.
