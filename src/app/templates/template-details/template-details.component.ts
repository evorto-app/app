import { CurrencyPipe, TitleCasePipe } from '@angular/common';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterModule } from '@angular/router';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faClock,
  faClockFour,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    MatButtonModule,
    RouterLink,
    FontAwesomeModule,
    MatIconModule,
    MatMenuModule,
    CurrencyPipe,
    TitleCasePipe,
    MatChipsModule,
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

  protected readonly templateId = input.required<string>();
  private queries = inject(QueriesService);
  protected readonly templateQuery = injectQuery(
    this.queries.template(this.templateId),
  );
}
