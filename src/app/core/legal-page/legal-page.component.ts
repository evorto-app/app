import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ConfigService } from '../config.service';
import {
  type TenantLegalPage,
  tenantLegalPageContent,
  tenantLegalPageTitle,
} from '../tenant-legal-links';

export const missingTenantLegalTextMessage =
  'No tenant-provided legal text is configured for this page.';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'bg-surface-container text-on-surface block min-h-dvh',
  },
  imports: [RouterLink],
  selector: 'app-legal-page',
  template: `
    <main
      class="bg-surface-container text-on-surface mx-auto min-h-dvh w-full max-w-3xl px-4 pb-28 pt-8 sm:pt-12 lg:pb-12"
    >
      <a
        class="text-primary mb-6 inline-block text-sm underline"
        routerLink="/"
      >
        Back to events
      </a>
      <h1 class="headline-medium mb-4">{{ title() }}</h1>
      @if (content(); as legalText) {
        <div class="text-on-surface whitespace-pre-wrap text-base leading-7">
          {{ legalText }}
        </div>
      } @else {
        <p class="text-on-surface-variant">
          {{ missingTenantLegalTextMessage }}
        </p>
      }
    </main>
  `,
})
export class LegalPageComponent {
  private readonly config = inject(ConfigService);
  private readonly route = inject(ActivatedRoute);
  private readonly page = this.route.snapshot.data[
    'legalPage'
  ] as TenantLegalPage;
  protected readonly content = computed(() =>
    tenantLegalPageContent(this.config.tenant, this.page),
  );

  protected readonly missingTenantLegalTextMessage =
    missingTenantLegalTextMessage;
  protected readonly title = computed(() => tenantLegalPageTitle(this.page));
}
