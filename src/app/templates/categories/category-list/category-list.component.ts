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
import { PermissionsService } from '../../../core/permissions.service';
import { IconComponent } from '../../../shared/components/icon/icon.component';
import {
  type CategorySaveDraft,
  type CategorySaveOutcome,
  CreateEditCategoryDialogComponent,
  type CreateEditCategoryDialogData,
} from '../create-edit-category-dialog/create-edit-category-dialog.component';

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
    Reflect.get(error, '_tag') === 'RpcForbiddenError' &&
    Reflect.get(error, 'permission') === 'templates:manageCategories'
  ) {
    return 'You can no longer manage template categories. No change was saved. Ask an administrator if you need this access.';
  }

  return getErrorMessage(
    error,
    'The save outcome could not be confirmed. Check the category list before trying again. Your entries are still here.',
    ['TemplateCategoryNotFoundError'],
  );
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
    return getErrorMessage(error, 'Template categories could not be loaded.');
  });
  private readonly categoryDialogOpen = signal(false);
  private createCategoryMutation = injectMutation(() =>
    this.appRpc.templateCategories.create.mutationOptions(),
  );
  private dialog = inject(MatDialog);
  private queryClient = inject(QueryClient);
  private updateCategoryMutation = injectMutation(() =>
    this.appRpc.templateCategories.update.mutationOptions(),
  );
  async openCategoryCreationDialog() {
    if (this.categoryActionDisabled()) {
      return;
    }

    this.categoryDialogOpen.set(true);
    try {
      const defaultIcon =
        this.templateCategoryGroupsQuery.data()?.[0]?.icon ?? fallbackIcon;
      const dialogReference = this.dialog.open<
        CreateEditCategoryDialogComponent,
        CreateEditCategoryDialogData,
        undefined
      >(CreateEditCategoryDialogComponent, {
        data: {
          defaultIcon,
          mode: 'create',
          save: (input) => this.saveCategory(input),
        },
      });
      await firstValueFrom(dialogReference.afterClosed());
    } finally {
      this.categoryDialogOpen.set(false);
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

    this.categoryDialogOpen.set(true);
    try {
      const dialogReference = this.dialog.open<
        CreateEditCategoryDialogComponent,
        CreateEditCategoryDialogData,
        undefined
      >(CreateEditCategoryDialogComponent, {
        data: {
          category,
          mode: 'edit',
          save: (input) => this.saveCategory(input, category.id),
        },
      });
      await firstValueFrom(dialogReference.afterClosed());
    } finally {
      this.categoryDialogOpen.set(false);
    }
  }

  protected categoryActionDisabled(): boolean {
    return (
      this.categoryDialogOpen() ||
      templateCategoryActionDisabled({
        canManageCategories: this.canManageCategories(),
        createPending: this.createCategoryMutation.isPending(),
        updatePending: this.updateCategoryMutation.isPending(),
      })
    );
  }

  private async saveCategory(
    input: CategorySaveDraft,
    categoryId?: string,
  ): Promise<CategorySaveOutcome> {
    try {
      if (categoryId === undefined) {
        await this.createCategoryMutation.mutateAsync({
          icon: input.icon,
          title: input.title,
        });
      } else {
        await this.updateCategoryMutation.mutateAsync({
          icon: input.icon,
          id: categoryId,
          title: input.title,
        });
      }
    } catch (error) {
      console.error(error);
      return {
        message: templateCategoryMutationErrorMessage(error),
        saved: false,
      };
    }

    const reads = await Promise.allSettled(
      [
        () =>
          this.queryClient.invalidateQueries(
            this.appRpc.queryFilter(['templateCategories', 'findMany']),
            { throwOnError: true },
          ),
        () =>
          this.queryClient.invalidateQueries(
            this.appRpc.queryFilter(['templates', 'groupedByCategory']),
            { throwOnError: true },
          ),
      ].map(async (read) => read()),
    );
    const failures = reads.flatMap((read) =>
      read.status === 'rejected' ? [read.reason] : [],
    );
    if (failures.length > 0) {
      console.error(
        new AggregateError(failures, 'Category list updates failed'),
      );
      return {
        message:
          'The category was saved, but the category list could not be updated. Close this dialog and load the category list again to see the saved details.',
        saved: true,
      };
    }
    return { saved: true };
  }
}
