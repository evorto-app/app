import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-esn-card-icon',
  imports: [],
  template: `
    <svg
      aria-hidden="true"
      class="block h-full w-full"
      fill="currentColor"
      focusable="false"
      height="1em"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      viewBox="0 0 56 56"
      width="1em"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M47 25H35.2l8.1-8.3c.4-.4.4-1 0-1.4l-2.6-2.6c-.4-.4-1-.4-1.4 0L31 20.8V9c0-.6-.4-1-1-1h-4c-.6 0-1 .4-1 1v11.8l-8.3-8.1c-.4-.4-1-.4-1.4 0l-2.6 2.6c-.4.4-.4 1 0 1.4l8.1 8.3H9c-.6 0-1 .4-1 1v4c0 .6.4 1 1 1h11.8l-8.3 8.3c-.4.4-.4 1.1 0 1.4l2.8 2.6c.4.4 1 .4 1.4 0l8.3-8.1V47c0 .6.4 1 1 1h4c.6 0 1-.4 1-1V35.2l8.3 8.1c.4.4 1 .4 1.4 0l2.6-2.6c.4-.4.4-1 0-1.4L35.2 31H47c.6 0 1-.4 1-1v-4c0-.6-.4-1-1-1zm-17.3 7h-3.3L24 29.7v-3.3l2.3-2.3h3.3l2.3 2.3v3.3L29.7 32z"
      ></path>
    </svg>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EsnCardIconComponent {}
