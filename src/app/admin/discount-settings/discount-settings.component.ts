import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';

interface ProviderForm {
  // Boolean form control mapped to API status "enabled" | "disabled"
  enabled: FormControl<boolean>;
  showCta: FormControl<boolean>;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
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
  protected readonly faArrowLeft = faArrowLeft;
  // Hard-coded ESNcard provider form
  esnCardForm = new FormGroup({
    enabled: new FormControl(false, { nonNullable: true }),
    ctaEnabled: new FormControl(false, { nonNullable: true }),
    ctaLink: new FormControl<string>('', { nonNullable: true }),
  });
  private trpc = injectTRPC();

  tenantQuery = injectQuery(() => this.trpc.config.tenant.queryOptions());

  private snackBar = inject(MatSnackBar);

  updateMutation = injectMutation(() =>
    this.trpc.discounts.setTenantProviders.mutationOptions({
      onError: (error: any) => {
        this.snackBar.open(
          `Failed to save settings: ${error.message}`,
          'Close',
          { duration: 5000 },
        );
      },
      onSuccess: () => {
        this.snackBar.open('Discount settings saved successfully', 'Close', {
          duration: 3000,
        });
        this.tenantQuery.refetch();
      },
    }),
  );

  // Effect: patch ESNcard form from server data
  private readonly patchFormEffect = effect(() => {
    const tenant = this.tenantQuery.data();
    const esn = (tenant as any)?.discountProviders?.esnCard;
    if (!esn) return;
    this.esnCardForm.patchValue(
      {
        enabled: !!esn.enabled,
        ctaEnabled: !!esn.config?.ctaEnabled,
        ctaLink: esn.config?.ctaLink ?? '',
      },
      { emitEvent: false },
    );
  });

  private readonly providerDescriptions: Record<string, string> = {
    esnCard:
      'Validate ESNcard credentials and provide discounts to ESN members',
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
        type: 'esnCard' as const,
        enabled,
        config: { ...(esn?.config ?? {}), ctaEnabled, ctaLink },
      },
    ];

    this.updateMutation.mutate({ providers: updates });
  }
}
