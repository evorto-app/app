import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import {
  ActivatedRoute,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faCalendarDays,
  faReceipt,
  faTags,
  faUser,
} from '@fortawesome/duotone-regular-svg-icons';

import { ConfigService } from '../../core/config.service';

export const profileChildPageActive = (
  childPath: string | undefined,
): boolean => childPath !== undefined && childPath !== '';

export const focusProfileDetailHeading = (content: HTMLElement): void => {
  const heading = content.querySelector<HTMLElement>('#profile-detail-heading');
  if (!heading) {
    throw new Error(
      'Profile detail routes must render #profile-detail-heading.',
    );
  }
  heading.focus({ preventScroll: true });
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FontAwesomeModule, RouterLink, RouterLinkActive, RouterOutlet],
  selector: 'app-profile-shell',
  templateUrl: './profile-shell.component.html',
})
export class ProfileShellComponent {
  protected readonly childPageActive = signal(false);
  private readonly config = inject(ConfigService);
  protected readonly esnEnabled = computed(
    () =>
      this.config.tenantSignal()?.discountProviders?.esnCard.status ===
      'enabled',
  );
  protected readonly faCalendarDays = faCalendarDays;
  protected readonly faReceipt = faReceipt;
  protected readonly faTags = faTags;
  protected readonly faUser = faUser;
  private readonly content = viewChild.required<
    HTMLElement,
    ElementRef<HTMLElement>
  >('profileContent', { read: ElementRef });
  private readonly injector = inject(Injector);
  private readonly route = inject(ActivatedRoute);

  protected onOutletActivate(): void {
    const childPath = this.route.firstChild?.snapshot.routeConfig?.path;
    const childPageActive = profileChildPageActive(childPath);
    this.childPageActive.set(childPageActive);
    if (!childPageActive) {
      return;
    }

    afterNextRender(
      {
        write: () => focusProfileDetailHeading(this.content().nativeElement),
      },
      { injector: this.injector },
    );
  }
}
