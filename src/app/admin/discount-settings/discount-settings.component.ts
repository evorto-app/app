import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectMutation, injectQuery } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';

interface ProviderForm {
  // Boolean form control mapped to API status "enabled" | "disabled"
  enabled: FormControl<boolean>;
  showCta: FormControl<boolean>;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatButtonModule,
    FontAwesomeModule,
    RouterLink,
  ],
  selector: 'app-discount-settings',
  templateUrl: './discount-settings.component.html',
})
export class DiscountSettingsComponent {
  // Hard-coded ESNcard provider form
  esnCardForm = new FormGroup({
    ctaEnabled: new FormControl(false, { nonNullable: true }),
    ctaLink: new FormControl<string>('', { nonNullable: true }),
    enabled: new FormControl(false, { nonNullable: true }),
  });
  private trpc = injectTRPC();
  tenantQuery = injectQuery(() => this.trpc.config.tenant.queryOptions());

  private snackBar = inject(MatSnackBar);

  updateMutation = injectMutation(() =>
    this.trpc.discounts.setTenantProviders.mutationOptions({
      onError: (error: any) => {
        this.snackBar.open(`Failed to save settings: ${error.message}`, 'Close', {
          duration: 5000,
        });
      },
      onSuccess: () => {
        this.snackBar.open('Discount settings saved successfully', 'Close', {
          duration: 3000,
        });
        this.tenantQuery.refetch();
      },
    }),
  );

  protected readonly faArrowLeft = faArrowLeft;

  // Effect: patch ESNcard form from server data
  private readonly patchFormEffect = effect(() => {
    const tenant = this.tenantQuery.data();
    const esn = (tenant as any)?.discountProviders?.esnCard;
    if (!esn) return;
    this.esnCardForm.patchValue(
      {
        ctaEnabled: !!esn.config?.ctaEnabled,
        ctaLink: esn.config?.ctaLink ?? '',
        enabled: !!esn.enabled,
      },
      { emitEvent: false },
    );
  });

  private readonly providerDescriptions: Record<string, string> = {
    esnCard: 'Validate ESNcard credentials and provide discounts to ESN members',
  };
  private readonly providerDisplayNames: Record<string, string> = {
    esnCard: 'ESNcard',
  };

  getProviderDescription(type: string): string {
    return this.providerDescriptions[type] || `${type} discount provider`;
  }

  getProviderDisplayName(type: string): string {
    return this.providerDisplayNames[type] || type;
  }

  saveSettings(): void {
    const tenant = this.tenantQuery.data();
    const esn = (tenant as any)?.discountProviders?.esnCard;

    const enabled = this.esnCardForm.controls.enabled.value;
    const ctaEnabled = this.esnCardForm.controls.ctaEnabled.value;
    const ctaLink = this.esnCardForm.controls.ctaLink.value?.trim();

    const updates = [
      {
        config: { ...esn?.config, ctaEnabled, ctaLink },
        enabled,
        type: 'esnCard' as const,
      },
    ];

    this.updateMutation.mutate({ providers: updates });
  }
}
