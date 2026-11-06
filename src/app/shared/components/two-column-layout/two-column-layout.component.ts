import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.independent-scroll]': 'independentScroll()',
    '[class.lg:h-full]': 'independentScroll()',
    '[class.lg:min-h-0]': 'independentScroll()',
    class: 'block min-w-0',
  },
  selector: 'app-two-column-layout',
  styles: `
    [tabindex='0']:focus:not(:focus-visible) {
      outline: none;
    }
  `,
  template: `
    <div
      class="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]"
      [style.--sidebar-width]="sidebarWidth()"
      [class]="
        independentScroll()
          ? 'lg:h-full lg:min-h-0 lg:grid-rows-[minmax(0,1fr)]'
          : 'lg:items-start lg:p-4'
      "
    >
      <div
        class="min-w-0 flex-col lg:flex"
        [class]="
          (detailActive() ? 'hidden' : 'flex') +
          (independentScroll()
            ? ' lg:min-h-0 lg:h-full'
            : ' lg:sticky lg:top-0 lg:max-h-[calc(100dvh-6rem)]')
        "
      >
        <div
          class="shrink-0 px-2 pb-4 empty:hidden"
          [class]="independentScroll() ? 'lg:px-4 lg:pt-10' : 'lg:px-0'"
        >
          <ng-content select="[twoColumnHeader]" />
        </div>
        <div
          class="min-h-0 px-2 lg:overflow-y-auto lg:overscroll-y-contain"
          [class]="
            independentScroll() ? 'lg:flex-1 lg:px-4 lg:pb-4' : 'lg:px-0'
          "
          [attr.role]="sidebarLabel() ? 'region' : null"
          [attr.aria-label]="sidebarLabel()"
          [attr.tabindex]="independentScroll() ? 0 : null"
        >
          <ng-content select="[twoColumnSidebar]" />
        </div>
        <div class="shrink-0 px-2 pt-4 empty:hidden lg:px-4">
          <ng-content select="[twoColumnFooter]" />
        </div>
      </div>
      <div
        class="min-w-0"
        [class]="
          independentScroll()
            ? 'lg:min-h-0 lg:overflow-y-auto lg:overscroll-y-contain lg:pr-4 lg:pt-6'
            : ''
        "
        [attr.role]="detailLabel() ? 'region' : null"
        [attr.aria-label]="detailLabel()"
        [attr.tabindex]="independentScroll() ? 0 : null"
      >
        <ng-content select="[twoColumnDetail]" />
      </div>
    </div>
  `,
})
export class TwoColumnLayoutComponent {
  readonly detailActive = input(false);
  readonly independentScroll = input(false);
  readonly sidebarWidth = input<'300px' | '380px' | '400px'>('300px');
  readonly sidebarLabel = input<string>();
  readonly detailLabel = input<string>();
}
