import { CommonModule, CurrencyPipe, TitleCasePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink, RouterModule } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faClock,
  faClockFour,
  faEllipsisVertical,
  faPlus,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { injectTRPC } from '../../core/trpc-client';
import { RegistrationStartOffsetPipe } from '../../shared/pipes/registration-start-offset.pipe';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    RouterLink,
    FontAwesomeModule,
    MatMenuModule,
    CurrencyPipe,
    TitleCasePipe,
    MatChipsModule,
    RegistrationStartOffsetPipe,
  ],
  selector: 'app-template-details',
  styles: ``,
  templateUrl: './template-details.component.html',
})
export class TemplateDetailsComponent {
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faClock = faClock;
  protected readonly faClockFour = faClockFour;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly faPlus = faPlus;

  private readonly rpc = AppRpc.injectClient();
  protected readonly taxRatesQuery = injectQuery(() =>
    this.rpc.taxRates.listActive.queryOptions(),
  );
  private trpc = injectTRPC();
  // eslint-disable-next-line perfectionist/sort-classes -- `templateQuery` depends on `trpc` initialization
  protected readonly taxRateById = computed(() => {
    const rates = this.taxRatesQuery.data() ?? [];
    return Object.fromEntries(rates.map((r) => [r.stripeTaxRateId, r]));
  });
  protected readonly templateId = input.required<string>();
  protected readonly templateQuery = injectQuery(() =>
    this.trpc.templates.findOne.queryOptions({ id: this.templateId() }),
  );
  protected findRateByStripeId(id: null | string | undefined) {
    const map = this.taxRateById();
    return id ? map[id] : undefined;
  }
}
