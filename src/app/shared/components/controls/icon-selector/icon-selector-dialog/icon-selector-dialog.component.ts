import type { IconAddUsage } from '@shared/rpc-contracts/app-rpcs/icons.rpcs';
import type { IconValue } from '@shared/types/icon';

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { debounce, form, FormField, maxLength } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { isValidIcons8IconName } from '@shared/rpc-contracts/app-rpcs/icons.rpcs';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../../../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../../../../core/error-message';
import { IconComponent } from '../../../icon/icon.component';

export interface IconSelectorDialogData {
  readonly usage: IconAddUsage;
}

export const iconAddErrorMessage = (error: unknown): string => {
  const tag =
    error && typeof error === 'object' ? Reflect.get(error, '_tag') : undefined;
  switch (tag) {
    case 'IconSourceBusyError': {
      return 'The icon source is busy. Try again shortly.';
    }
    case 'IconSourceUnavailableError': {
      return 'That Icons8 icon could not be verified. Check the name and try again.';
    }
    case 'InvalidIconNameError': {
      return 'Use a lowercase Icons8 name with letters, numbers, hyphens, and at most one style suffix.';
    }
    case 'RpcForbiddenError': {
      return 'You do not have permission to add icons here.';
    }
    default: {
      return getErrorMessage(error, 'The icon could not be added.');
    }
  }
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    // NotificationComponent,
    IconComponent,
    FormField,
  ],
  selector: 'app-icon-selector-dialog',
  styles: ``,
  templateUrl: './icon-selector-dialog.component.html',
})
export class IconSelectorDialogComponent {
  private readonly rpc = AppRpc.injectClient();
  protected readonly addIconMutation = injectMutation(() =>
    this.rpc.icons.add.mutationOptions(),
  );
  protected readonly addIconError = computed(() =>
    this.addIconMutation.isError()
      ? iconAddErrorMessage(this.addIconMutation.error())
      : '',
  );
  protected readonly searchModel = signal({ query: '' });
  protected readonly searchForm = form(this.searchModel, (schema) => {
    debounce(schema, 300);
    maxLength(schema.query, 64);
  });
  protected readonly searchValue = computed(
    () => this.searchForm().value().query,
  );
  protected readonly directAccessIcon = computed<IconValue>(() => ({
    iconColor: 0,
    iconName: this.searchValue(),
  }));
  protected readonly searchWithinLimit = computed(
    () => this.searchValue().length <= 64,
  );
  protected readonly iconSearchQuery = injectQuery(() => ({
    ...this.rpc.icons.search.queryOptions({ search: this.searchValue() }),
    enabled: this.searchWithinLimit(),
  }));
  protected displayDirectAccess = computed(() => {
    return this.iconSearchQuery.isSuccess()
      ? this.iconSearchQuery.data().length === 0 &&
          this.searchWithinLimit() &&
          isValidIcons8IconName(this.searchValue())
      : false;
  });
  protected readonly iconChoices = computed(() => {
    return this.iconSearchQuery.isSuccess()
      ? this.iconSearchQuery.data().map((icon) => ({
          ...icon,
          value: {
            iconColor: icon.sourceColor ?? 0,
            iconName: icon.commonName,
          } satisfies IconValue,
        }))
      : [];
  });
  protected readonly invalidDirectAccessName = computed(
    () =>
      this.searchValue().length > 0 &&
      this.searchWithinLimit() &&
      this.iconSearchQuery.isSuccess() &&
      this.iconSearchQuery.data().length === 0 &&
      !isValidIcons8IconName(this.searchValue()),
  );
  private readonly data = inject<IconSelectorDialogData>(MAT_DIALOG_DATA);
  private readonly dialogReference = inject(
    MatDialogRef<IconSelectorDialogComponent, IconValue>,
  );
  private readonly queryClient = inject(QueryClient);

  saveIconDirectly() {
    const icon = this.searchValue();
    this.addIconMutation.mutate(
      { icon, usage: this.data.usage },
      {
        onSuccess: async (addedIcon) => {
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['icons', 'search']),
          );
          this.dialogReference.close({
            iconColor: addedIcon.sourceColor ?? 0,
            iconName: addedIcon.commonName,
          });
        },
      },
    );
  }
}
