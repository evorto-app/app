import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-error',
  template: `
    <div class="mx-auto max-w-screen-md p-8 text-center">
      <h1 class="headline-large mb-2">Something went wrong</h1>
      <p class="body-large text-outline">Please try again later.</p>
    </div>
  `,
})
export class ErrorComponent {}

