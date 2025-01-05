import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  injectQueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { injectTrpcClient } from '../../../core/trpc-client';
import { CreateEditCategoryDialogComponent } from '../create-edit-category-dialog/create-edit-category-dialog.component';

@Component({
  imports: [MatButtonModule, FontAwesomeModule, MatIconModule, RouterLink],
  selector: 'app-category-list',
  styles: ``,
  templateUrl: './category-list.component.html',
})
export class CategoryListComponent {
  protected readonly faArrowLeft = faArrowLeft;
  private trpc = injectTrpcClient();
  protected templateCategoriesQuery = injectQuery(() => ({
    queryFn: () => this.trpc.templateCategories.findMany.query(),
    queryKey: ['templateCategories'],
  }));
  private queryClient = injectQueryClient();
  private createCategoryMutation = injectMutation(() => ({
    mutationFn: (input: { icon: string; title: string }) =>
      this.trpc.templateCategories.create.mutate(input),
    onSuccess: () => {
      this.queryClient.invalidateQueries({ queryKey: ['templateCategories'] });
    },
  }));
  private dialog = inject(MatDialog);
  private updateQueryMutation = injectMutation(() => ({
    mutationFn: (input: { id: string; title: string }) =>
      this.trpc.templateCategories.update.mutate(input),
    onSuccess: (data) => {
      this.queryClient.invalidateQueries({ queryKey: ['templateCategories'] });
      this.queryClient.invalidateQueries({
        queryKey: ['templateCategory', data.id],
      });
    },
  }));

  async openCategoryCreationDialog() {
    const result = await firstValueFrom(
      this.dialog
        .open(CreateEditCategoryDialogComponent, { data: { mode: 'create' } })
        .afterClosed(),
    );
    if (!result) return;
    this.createCategoryMutation.mutate(result);
  }

  async openCategoryEditDialog(category: { id: string; title: string }) {
    const result = await firstValueFrom(
      this.dialog
        .open(CreateEditCategoryDialogComponent, {
          data: { category, mode: 'edit' },
        })
        .afterClosed(),
    );
    if (!result) return;
    this.updateQueryMutation.mutate({ id: category.id, title: result.title });
  }
}
