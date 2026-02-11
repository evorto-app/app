import type { IconValue } from '@shared/types/icon';

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
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

import { AppRpc } from '../../../core/effect-rpc-angular-client';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { CreateEditCategoryDialogComponent } from '../create-edit-category-dialog/create-edit-category-dialog.component';

const fallbackIcon: IconValue = { iconColor: 0, iconName: 'city' };

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    FontAwesomeModule,
    MatIconModule,
    MatTableModule,
    RouterLink,
    IconComponent,
  ],
  selector: 'app-category-list',
  styles: ``,
  templateUrl: './category-list.component.html',
})
export class CategoryListComponent {
  protected readonly columnsToDisplay = signal<string[]>([
    'category',
    'templates',
    'actions',
  ]);
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly outletActive = signal(false);
  private readonly rpc = AppRpc.injectClient();
  protected templateCategoryGroupsQuery = injectQuery(() =>
    this.rpc.templates.groupedByCategory.queryOptions(),
  );
  protected readonly templateCategoryGroupsErrorMessage = computed(() => {
    const error = this.templateCategoryGroupsQuery.error();
    return typeof error === 'string' ? error : (error?.message ?? 'Unknown error');
  });
  private createCategoryMutation = injectMutation(() =>
    this.rpc.templateCategories.create.mutationOptions(),
  );
  private dialog = inject(MatDialog);
  private queryClient = inject(QueryClient);

  private updateCategoryMutation = injectMutation(() =>
    this.rpc.templateCategories.update.mutationOptions(),
  );

  async openCategoryCreationDialog() {
    const defaultIcon =
      this.templateCategoryGroupsQuery.data()?.[0]?.icon ?? fallbackIcon;
    const dialogReference = this.dialog.open<
      CreateEditCategoryDialogComponent,
      { defaultIcon: IconValue; mode: 'create' },
      { icon: IconValue; title: string }
    >(CreateEditCategoryDialogComponent, {
      data: { defaultIcon, mode: 'create' },
    });
    const result = await firstValueFrom(dialogReference.afterClosed());
    if (result?.title) {
      await this.createCategoryMutation.mutateAsync({
        icon: result.icon,
        title: result.title,
      });
      await this.queryClient.invalidateQueries(
        this.rpc.queryFilter(['templateCategories', 'findMany']),
      );
      await this.queryClient.invalidateQueries(
        this.rpc.queryFilter(['templates', 'groupedByCategory']),
      );
    }
  }

  async openCategoryEditDialog(category: {
    icon: IconValue;
    id: string;
    title: string;
  }) {
    const dialogReference = this.dialog.open(
      CreateEditCategoryDialogComponent,
      {
        data: { category, mode: 'edit' },
      },
    );
    const result = (await firstValueFrom(dialogReference.afterClosed())) as
      | undefined
      | { icon: IconValue; title: string };
    if (result?.title) {
      await this.updateCategoryMutation.mutateAsync({
        icon: result.icon,
        id: category.id,
        title: result.title,
      });
      await this.queryClient.invalidateQueries(
        this.rpc.queryFilter(['templateCategories', 'findMany']),
      );
      await this.queryClient.invalidateQueries(
        this.rpc.queryFilter(['templates', 'groupedByCategory']),
      );
    }
  }
}
