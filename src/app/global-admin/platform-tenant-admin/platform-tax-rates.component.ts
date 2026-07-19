import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  Injectable,
  input,
  signal,
  untracked,
} from '@angular/core';
import {
  form,
  FormField,
  maxLength,
  minLength,
  required,
  submit,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { PlatformTenantPageHeaderComponent } from './platform-tenant-page-header.component';

interface TaxImportModel {
  ids: string[];
  reason: string;
}

@Injectable({ providedIn: 'root' })
export class PlatformTaxRatesOperations {
  private readonly rpc = AppRpc.injectClient();

  import() {
    return this.rpc.platform.taxRates.import.mutationOptions();
  }

  list(targetTenantId: string) {
    return this.rpc.platform.taxRates.listStripe.queryOptions({
      targetTenantId,
    });
  }

  taxRatesFilter() {
    return this.rpc.queryFilter(['platform', 'taxRates']);
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatTableModule,
    PlatformTenantPageHeaderComponent,
  ],
  selector: 'app-platform-tax-rates',
  templateUrl: './platform-tax-rates.component.html',
})
export class PlatformTaxRatesComponent {
  readonly tenantId = input.required<string>();

  protected readonly columns = [
    'name',
    'percentage',
    'jurisdiction',
    'imported',
  ];
  private readonly importModel = signal<TaxImportModel>({
    ids: [],
    reason: '',
  });
  protected readonly importForm = form(this.importModel, (model) => {
    minLength(model.ids, 1, { message: 'Select at least one tax rate.' });
    required(model.reason, { message: 'Enter an operational reason.' });
    maxLength(model.reason, 500, {
      message: 'Reason must be 500 characters or fewer.',
    });
  });

  private readonly operations = inject(PlatformTaxRatesOperations);
  protected readonly importMutation = injectMutation(() =>
    this.operations.import(),
  );
  protected readonly ratesQuery = injectQuery(() =>
    this.operations.list(this.tenantId()),
  );
  private readonly initializedTenantId = signal<null | string>(null);
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);

  constructor() {
    effect(() => {
      const tenantId = this.tenantId();
      if (this.initializedTenantId() === tenantId) return;
      untracked(() => {
        this.importModel.set({ ids: [], reason: '' });
        this.importForm().reset();
        this.initializedTenantId.set(tenantId);
      });
    });
  }

  protected importRates(event: Event): void {
    event.preventDefault();
    if (this.importMutation.isPending()) return;

    void submit(this.importForm, async () => {
      const model = this.importModel();
      try {
        await this.importMutation.mutateAsync({
          ids: model.ids,
          reason: model.reason,
          targetTenantId: this.tenantId(),
        });
        await this.queryClient.invalidateQueries(
          this.operations.taxRatesFilter(),
        );
        this.notifications.showSuccess('Tax rates imported');
        this.importModel.set({ ids: [], reason: '' });
        this.importForm().reset();
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to import tax rates'),
        );
      }
    });
  }
}
