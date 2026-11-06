import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import { SHAPE_PATHS } from './shape-paths';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block relative' },
  selector: 'app-shape',
  styles: `
    svg {
      width: 100%;
      height: auto;
      display: block;
      transform-origin: center;
      transform-box: fill-box;
      animation: app-shape-spin 90s linear infinite;
    }

    path {
      transition:
        d 550ms ease-in-out,
        color 350ms ease-in-out;
    }

    @keyframes app-shape-spin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      svg {
        animation: none;
      }
      path {
        transition: none;
      }
    }
  `,
  templateUrl: './shape.html',
})
export class Shape {
  public readonly changeSignal = input('');

  protected readonly current = computed(() => {
    // Keep the same event stable across SSR, hydration, and query refreshes.
    let hash = 0;
    for (const character of this.changeSignal()) {
      hash = (Math.imul(hash, 31) + (character.codePointAt(0) ?? 0)) >>> 0;
    }
    return SHAPE_PATHS[hash % SHAPE_PATHS.length];
  });
  protected readonly pathStyle = computed(() => `path("${this.current()}")`);
}
