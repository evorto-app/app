import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule],
  selector: 'app-error',
  template: `
    <div
      class="mx-auto grid max-w-screen-md justify-items-center gap-4 p-8 text-center"
    >
      <h1 class="headline-large mb-2">We couldn't load this page</h1>
      <p class="body-large text-outline">
        Return to the start page and choose where to go next.
      </p>
      <a mat-flat-button href="/">Go to start page</a>
    </div>
  `,
})
export class ErrorComponent {}
