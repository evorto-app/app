import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-not-found',
  template: `
    <div class="mx-auto max-w-screen-md p-8 text-center">
      <h1 class="headline-large mb-2">Page not found</h1>
      <p class="body-large text-on-surface-variant">
        The page you are looking for doesn’t exist.
      </p>
    </div>
  `,
})
export class NotFoundComponent {}
