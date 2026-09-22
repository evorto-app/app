import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  selector: 'app-not-allowed',
  styles: ``,
  template: `
    <div class="mx-auto max-w-screen-md p-8 text-center">
      <h1 class="headline-large mb-2">Access not allowed</h1>
      <p class="body-large text-outline">
        Your account does not have access to this page. Go back, or ask the
        person who manages your Evorto access if you think this is a mistake.
      </p>
    </div>
  `,
})
export class NotAllowedComponent {}
