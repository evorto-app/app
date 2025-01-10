import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { QueriesService } from '../../../core/queries.service';
import { CreateEditCategoryDialogComponent } from '../create-edit-category-dialog/create-edit-category-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, FontAwesomeModule, MatIconModule, RouterLink],
  selector: 'app-category-list',
  styles: ``,
  templateUrl: './category-list.component.html',
})
export class CategoryListComponent {
  protected readonly faArrowLeft = faArrowLeft;
  private queries = inject(QueriesService);
  protected templateCategoriesQuery = injectQuery(
    this.queries.templateCategories(),
  );
  private createCategoryMutation = injectMutation(
    this.queries.createTemplateCategory(),
  );
  private dialog = inject(MatDialog);
  private updateCategoryMutation = injectMutation(
    this.queries.updateTemplateCategory(),
  );

  async openCategoryCreationDialog() {
    const dialogReference = this.dialog.open(
      CreateEditCategoryDialogComponent,
      { data: { mode: 'create' } },
    );
    const result = await firstValueFrom(dialogReference.afterClosed());
    if (result) {
      await this.createCategoryMutation.mutateAsync(result);
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
    }
  }
}
