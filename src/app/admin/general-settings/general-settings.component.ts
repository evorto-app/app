import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
} from '@angular/core';
import { computed } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
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
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    LocationSelectorField,
  ],
  selector: 'app-general-settings',
  styles: ``,
  templateUrl: './general-settings.component.html',
})
export class GeneralSettingsComponent {
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
  protected readonly discountOverview = computed(() => {
    const providers = this.discountProvidersQuery.data() ?? [];
    let enabledCount = 0;
    for (const provider of providers) {
      if (provider.status === 'enabled') {
        enabledCount += 1;
      }
    }
    return {
      enabledCount,
      providers,
      totalCount: providers.length,
    };
  });
  protected readonly faArrowLeft = faArrowLeft;
  private readonly formBuilder = inject(NonNullableFormBuilder);
  protected readonly settingsForm = this.formBuilder.group({
    defaultLocation: this.formBuilder.control<GoogleLocationType | undefined>(
      void 0,
    ),
    theme: this.formBuilder.control<'esn' | 'evorto'>('evorto'),
  });
  private readonly configService = inject(ConfigService);
  private readonly dialog = inject(MatDialog);

  private readonly providerMetadata: Record<
    string,
    { description: string; name: string }
  > = {
    esnCard: {
      description:
        'Offer automatic discounts to members with a verified ESN card.',
      name: 'ESN Card',
    },
  };

  private readonly queryClient = inject(QueryClient);

  private updateSettingsMutation = injectMutation(() =>
    this.trpc.admin.tenant.updateSettings.mutationOptions(),
  );

  constructor() {
    effect(() => {
      const currentTenant = this.configService.tenant;
      if (currentTenant) {
        this.settingsForm.patchValue({
          defaultLocation: currentTenant.defaultLocation ?? undefined,
          theme: currentTenant.theme,
        });
      }
    });
  }

  saveSettings() {
    if (this.settingsForm.invalid) {
      return;
    }
    const settings = this.settingsForm.getRawValue();
    this.updateSettingsMutation.mutate(settings, {
      onSuccess: async () => {
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.config.tenant.pathKey(),
        });
      },
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

  protected providerDescription(providerType: string): string {
    return (
      this.providerMetadata[providerType]?.description ??
      'Configure availability and messaging for this discount provider.'
    );
  }

  protected providerName(providerType: string): string {
    return this.providerMetadata[providerType]?.name ?? providerType;
  }

}
