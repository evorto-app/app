import { Component } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { injectTrpcClient } from '../../../core/trpc-client';

@Component({
  imports: [],
  selector: 'app-category-list',
  styles: ``,
  templateUrl: './category-list.component.html',
})
export class CategoryListComponent {
  private trpc = injectTrpcClient();
  protected templateCategoriesQuery = injectQuery(() => ({
    queryFn: () => this.trpc.templateCategories.findMany.query(),
    queryKey: ['templateCategories'],
  }));
}
