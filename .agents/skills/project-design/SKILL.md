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

## Material Theming (Tailwind-First)

In this project, Material theming is consumed primarily through Tailwind tokens defined in `/Users/hedde/code/evorto/src/tailwind.css`, not through Angular Material utility classes.

### Rules

1. Treat `src/tailwind.css` as the theming bridge from Material system tokens (`--mat-sys-*`) to Tailwind tokens (`--color-*`, `--radius-*`, font tokens).
2. In templates, prefer Tailwind semantic classes such as `bg-surface`, `text-on-surface`, `bg-primary-container`, and `rounded-2xl`.
3. In component CSS, use `var(--mat-sys-*)` directly only when a style cannot be expressed cleanly with existing Tailwind utilities.
4. If a needed token is missing, extend the mapping in `src/tailwind.css` instead of introducing hardcoded hex values.
5. Keep dark/light behavior token-driven via Material system variables; avoid component-level theme branching unless required.

### Practical Workflow

1. Pick the Material role/token (for example surface, on-surface, primary-container).
2. Use the mapped Tailwind utility first (`bg-*`, `text-*`, `rounded-*`).
3. Add or adjust token mappings in `src/tailwind.css` when coverage is missing.

Reference: [Angular Material - Theming your components](https://material.angular.dev/guide/theming-your-components) (focus on CSS variables/system tokens).
