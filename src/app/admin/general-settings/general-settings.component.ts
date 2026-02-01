import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
} from '@angular/core';
import { computed } from '@angular/core';
import { form, FormField, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { GoogleLocationType } from '../../../types/location';
import { ConfigService } from '../../core/config.service';
import { injectTRPC } from '../../core/trpc-client';
import { LocationSelectorField } from '../../shared/components/controls/location-selector/location-selector-field/location-selector-field';
import { ImportTaxRatesDialogComponent } from '../components/import-tax-rates-dialog/import-tax-rates-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    RouterLink,
    MatButtonModule,
    MatSlideToggleModule,
    MatCheckboxModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    FormField,
    LocationSelectorField,
  ],
  selector: 'app-general-settings',
  styles: ``,
  templateUrl: './general-settings.component.html',
})
export class GeneralSettingsComponent {
  protected readonly settingsModel = signal<{
    defaultLocation: GoogleLocationType | null;
    theme: 'esn' | 'evorto';
  }>({
    defaultLocation: null,
    theme: 'evorto',
  });
  protected readonly settingsForm = form(this.settingsModel);
  private readonly trpc = injectTRPC();
  protected readonly importedTaxRatesQuery = injectQuery(() =>
    this.trpc.admin.tenant.listImportedTaxRates.queryOptions(),
  );
  protected readonly compatibleImportedRates = computed(() =>
    (this.importedTaxRatesQuery.data() ?? []).filter(
      (r) => r.inclusive && r.active,
    ),
  );
  protected readonly discountProvidersQuery = injectQuery(() =>
    this.trpc.discounts.getTenantProviders.queryOptions(),
  );
  // Derived state for ESN provider
  protected readonly esnEnabled = computed(() => {
    const providers = this.discountProvidersQuery.data();
    if (!providers) return false;
    return providers.find((p) => p.type === 'esnCard')?.status === 'enabled';
  });
  protected readonly faArrowLeft = faArrowLeft;
  private readonly queryClient = inject(QueryClient);
  protected readonly setProvidersMutation = injectMutation(() =>
    this.trpc.discounts.setTenantProviders.mutationOptions({
      onSuccess: async () => {
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.discounts.getTenantProviders.pathKey(),
        });
      },
    }),
  );

  private readonly configService = inject(ConfigService);
  private readonly dialog = inject(MatDialog);

  private updateSettingsMutation = injectMutation(() =>
    this.trpc.admin.tenant.updateSettings.mutationOptions(),
  );

  constructor() {
    effect(() => {
      const currentTenant = this.configService.tenant;
      if (currentTenant) {
        this.settingsModel.set({
          defaultLocation: currentTenant.defaultLocation,
          theme: currentTenant.theme,
        });
      }
    });
  }

  async saveSettings(event: Event) {
    event.preventDefault();
    await submit(this.settingsForm, async (formState) => {
      const settings = formState().value();
      this.updateSettingsMutation.mutate(settings, {
        onSuccess: async () => {
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.config.tenant.pathKey(),
          });
        },
      });
    });
  }

  protected openImportDialog() {
    const reference = this.dialog.open(ImportTaxRatesDialogComponent);
    reference.afterClosed().subscribe(async (imported) => {
      if (imported) {
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.admin.tenant.listImportedTaxRates.pathKey(),
        });
      }
    });
  }

  protected setEsnEnabled(checked: boolean) {
    this.setProvidersMutation.mutate({
      providers: [
        {
          config: {},
          status: checked ? 'enabled' : 'disabled',
          type: 'esnCard',
        },
      ],
    });
  }
}
