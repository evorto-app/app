import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { injectTRPC } from '../../../core/trpc-client';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { CreateEditCategoryDialogComponent } from '../create-edit-category-dialog/create-edit-category-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    FontAwesomeModule,
    MatIconModule,
    RouterLink,
    IconComponent,
  ],
  selector: 'app-category-list',
  styles: ``,
  templateUrl: './category-list.component.html',
})
export class CategoryListComponent {
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly outletActive = signal(false);
  private trpc = injectTRPC();
  protected templateCategoriesQuery = injectQuery(() =>
    this.trpc.templateCategories.findMany.queryOptions(),
  );
  private createCategoryMutation = injectMutation(() =>
    this.trpc.templateCategories.create.mutationOptions(),
  );
  private dialog = inject(MatDialog);
  private queryClient = inject(QueryClient);

  private updateCategoryMutation = injectMutation(() =>
    this.trpc.templateCategories.update.mutationOptions(),
  );

  async openCategoryCreationDialog() {
    const dialogReference = this.dialog.open(
      CreateEditCategoryDialogComponent,
      { data: { mode: 'create' } },
    );
    const result = await firstValueFrom(dialogReference.afterClosed());
    if (result) {
      await this.createCategoryMutation.mutateAsync(result);
      await this.queryClient.invalidateQueries({
        queryKey: this.trpc.templateCategories.findMany.pathKey(),
      });
      await this.queryClient.invalidateQueries({
        queryKey: this.trpc.templates.groupedByCategory.pathKey(),
      });
    }
  }

  async openCategoryEditDialog(category: { id: string; title: string }) {
    const dialogReference = this.dialog.open(
      CreateEditCategoryDialogComponent,
      {
        data: { category, mode: 'edit' },
      },
    );
    const result = await firstValueFrom(dialogReference.afterClosed());
    if (result) {
      await this.updateCategoryMutation.mutateAsync({
        id: category.id,
        ...result,
      });
      await this.queryClient.invalidateQueries({
        queryKey: this.trpc.templateCategories.findMany.pathKey(),
      });
      await this.queryClient.invalidateQueries({
        queryKey: this.trpc.templates.groupedByCategory.pathKey(),
      });
    }
  }
}
