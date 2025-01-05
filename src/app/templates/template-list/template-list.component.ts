import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faEllipsisVertical } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { injectTrpcClient } from '../../core/trpc-client';

@Component({
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    FontAwesomeModule,
    MatMenuModule,
  ],
  selector: 'app-template-list',
  styles: ``,
  templateUrl: './template-list.component.html',
})
export class TemplateListComponent {
  protected readonly faEllipsisVertical = faEllipsisVertical;
  private trpc = injectTrpcClient();
  protected templateQuery = injectQuery(() => ({
    queryFn: () => this.trpc.templates.groupedByCategory.query(),
    queryKey: ['templatesByCategory'],
  }));
}
