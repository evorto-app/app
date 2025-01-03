import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { injectTrpcClient } from '../../core/trpc-client';

@Component({
  imports: [RouterLink],
  selector: 'app-template-list',
  styles: ``,
  templateUrl: './template-list.component.html',
})
export class TemplateListComponent {
  private trpc = injectTrpcClient();
  protected templateQuery = injectQuery(() => ({
    queryFn: () => this.trpc.templates.groupedByCategory.query(),
    queryKey: ['templates'],
  }));
}
