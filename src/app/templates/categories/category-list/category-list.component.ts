import type { IconValue } from '@shared/types/icon';

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faEllipsisVertical,
  faPlus,
} from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { AppRpc } from '../../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../../core/error-message';
import { NotificationService } from '../../../core/notification.service';
import { PermissionsService } from '../../../core/permissions.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import { CreateEditCategoryDialogComponent } from '../create-edit-category-dialog/create-edit-category-dialog.component';

const fallbackIcon: IconValue = { iconColor: 0, iconName: 'city' };

export const templateCategoryActionDisabled = ({
  canManageCategories,
  createPending,
  updatePending,
}: {
  canManageCategories: boolean;
  createPending: boolean;
  updatePending: boolean;
}): boolean => !canManageCategories || createPending || updatePending;

export const templateCategoryColumns = (
  canManageCategories: boolean,
): string[] =>
  canManageCategories
    ? ['category', 'templates', 'actions']
    : ['category', 'templates'];

export const templateCategoryMutationErrorMessage = (
  error: unknown,
): string => {
  if (
    error &&
    typeof error === 'object' &&
    Reflect.get(error, 'permission') === 'templates:manageCategories'
  ) {
    return 'You no longer have permission to manage template categories. Reload the page to refresh your access, or ask an administrator for this permission.';
  }

  return getErrorMessage(error, 'Template category could not be saved');
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    FontAwesomeModule,
    MatTableModule,
    RouterLink,
    IconComponent,
  ],
  selector: 'app-category-list',
  styles: ``,
  templateUrl: './category-list.component.html',
})
export class CategoryListComponent {
  protected readonly appRpc = AppRpc.injectClient();
  protected readonly canManageCategories = inject(
    PermissionsService,
  ).hasPermission('templates:manageCategories');
  protected readonly columnsToDisplay = computed(() =>
    templateCategoryColumns(this.canManageCategories()),
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly faPlus = faPlus;
  protected templateCategoryGroupsQuery = injectQuery(() =>
    this.appRpc.templates.groupedByCategory.queryOptions(),
  );
  protected readonly templateCategoryGroupsErrorMessage = computed(() => {
    const error = this.templateCategoryGroupsQuery.error();
    return getErrorMessage(error, 'Unknown error');
  });
  private createCategoryMutation = injectMutation(() =>
    this.appRpc.templateCategories.create.mutationOptions(),
  );
  private dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);
  private queryClient = inject(QueryClient);
  private updateCategoryMutation = injectMutation(() =>
    this.appRpc.templateCategories.update.mutationOptions(),
  );
  async openCategoryCreationDialog() {
    if (this.categoryActionDisabled()) {
      return;
    }

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
      try {
        await this.createCategoryMutation.mutateAsync({
          icon: result.icon,
          title: result.title,
        });
        await this.queryClient.invalidateQueries(
          this.appRpc.queryFilter(['templateCategories', 'findMany']),
        );
        await this.queryClient.invalidateQueries(
          this.appRpc.queryFilter(['templates', 'groupedByCategory']),
        );
      } catch (error) {
        this.notifications.showError(
          templateCategoryMutationErrorMessage(error),
        );
      }
    }
  }

  async openCategoryEditDialog(category: {
    icon: IconValue;
    id: string;
    title: string;
  }) {
    if (this.categoryActionDisabled()) {
      return;
    }

    const dialogReference = this.dialog.open(
      CreateEditCategoryDialogComponent,
      {
        data: { category, mode: 'edit' },
      },
    );
    const result = (await firstValueFrom(dialogReference.afterClosed())) as
      undefined | { icon: IconValue; title: string };
    if (result?.title) {
      try {
        await this.updateCategoryMutation.mutateAsync({
          icon: result.icon,
          id: category.id,
          title: result.title,
        });
        await this.queryClient.invalidateQueries(
          this.appRpc.queryFilter(['templateCategories', 'findMany']),
        );
        await this.queryClient.invalidateQueries(
          this.appRpc.queryFilter(['templates', 'groupedByCategory']),
        );
      } catch (error) {
        this.notifications.showError(
          templateCategoryMutationErrorMessage(error),
        );
      }
    }
  }

  protected categoryActionDisabled(): boolean {
    return templateCategoryActionDisabled({
      canManageCategories: this.canManageCategories(),
      createPending: this.createCategoryMutation.isPending(),
      updatePending: this.updateCategoryMutation.isPending(),
    });
  }
}
