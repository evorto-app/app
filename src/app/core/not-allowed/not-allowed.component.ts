import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  selector: 'app-not-allowed',
  styles: ``,
  template: `
    <div class="mx-auto max-w-screen-md p-8 text-center">
      <h1 class="headline-large mb-2">Access not allowed</h1>
      <p class="body-large text-on-surface-variant">
        Your account does not have permission to open this page.
      </p>
    </div>
  `,
})
export class NotAllowedComponent {}
