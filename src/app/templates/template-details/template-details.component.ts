import { Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';

@Component({
  imports: [
    MatButtonModule,
    RouterLink,
    FontAwesomeModule,
    MatIconModule,
    FontAwesomeModule,
    MatMenuModule,
  ],
  selector: 'app-template-details',
  styles: ``,
  templateUrl: './template-details.component.html',
})
export class TemplateDetailsComponent {
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEllipsisVertical = faEllipsisVertical;

  protected readonly templateId = input.required<string>();
  private queries = inject(QueriesService);
  protected readonly templateQuery = injectQuery(
    this.queries.template(this.templateId),
  );
}
