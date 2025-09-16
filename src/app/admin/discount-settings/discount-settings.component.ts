import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { injectMutation, injectQuery } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';

interface ProviderForm {
  status: FormControl<'enabled' | 'disabled'>;
  showCta: FormControl<boolean>;
}

@Component({
  selector: 'app-discount-settings',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatSlideToggleModule,
    MatButtonModule,
  ],
  template: `
    <div class="p-6">
      <h1 class="text-2xl font-bold mb-6">Discount Provider Settings</h1>
      
      @if (providersQuery.data(); as providers) {
        <div class="space-y-6">
          @for (provider of providers; track provider.type) {
            <mat-card class="p-6">
              <div class="flex justify-between items-start">
                <div>
                  <h3 class="text-lg font-semibold">{{ getProviderDisplayName(provider.type) }}</h3>
                  <p class="text-gray-600 mt-1">{{ getProviderDescription(provider.type) }}</p>
                </div>
                
                <form [formGroup]="getProviderForm(provider.type)" class="space-y-4">
                  <div class="flex items-center gap-4">
                    <mat-slide-toggle 
                      formControlName="status"
                      [checked]="getProviderForm(provider.type).get('status')?.value === 'enabled'"
                      (change)="onProviderStatusChange(provider.type, $event.checked)"
                      data-testid="enable-esn-provider">
                      {{ getProviderForm(provider.type).get('status')?.value === 'enabled' ? 'Enabled' : 'Disabled' }}
                    </mat-slide-toggle>
                  </div>
                  
                  @if (getProviderForm(provider.type).get('status')?.value === 'enabled') {
                    <div class="ml-4 space-y-2">
                      <mat-slide-toggle 
                        formControlName="showCta"
                        data-testid="esn-show-cta-toggle">
                        Show "Get ESN Card" call-to-action
                      </mat-slide-toggle>
                    </div>
                  }
                </form>
              </div>
            </mat-card>
          }
        </div>
        
        <div class="mt-6 flex justify-end">
          <button 
            mat-raised-button 
            color="primary"
            (click)="saveSettings()"
            [disabled]="updateMutation.isPending()"
            data-testid="save-discount-settings">
            @if (updateMutation.isPending()) {
              Saving...
            } @else {
              Save Settings
            }
          </button>
        </div>
      }
      
      @if (providersQuery.isLoading()) {
        <div class="text-center py-8">Loading discount providers...</div>
      }
      
      @if (providersQuery.isError()) {
        <div class="text-red-500 text-center py-8">
          Failed to load discount providers: {{ providersQuery.error()?.message }}
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscountSettingsComponent {
  private snackBar = inject(MatSnackBar);
  private trpc = injectTRPC();
  
  providersQuery = injectQuery(() =>
    this.trpc.discounts.getTenantProviders.queryOptions(),
  );

  updateMutation = injectMutation(() =>
    this.trpc.discounts.setTenantProviders.mutationOptions({
      onSuccess: () => {
        this.snackBar.open('Discount settings saved successfully', 'Close', { duration: 3000 });
        this.providersQuery.refetch();
      },
      onError: (error: any) => {
        this.snackBar.open(`Failed to save settings: ${error.message}`, 'Close', { duration: 5000 });
      },
    }),
  );

  private providerForms = new Map<string, FormGroup<ProviderForm>>();

  getProviderForm(providerType: string): FormGroup<ProviderForm> {
    if (!this.providerForms.has(providerType)) {
      const provider = this.providersQuery.data()?.find((p: any) => p.type === providerType);
      const form = new FormGroup<ProviderForm>({
        status: new FormControl(provider?.status || 'disabled', { nonNullable: true }),
        showCta: new FormControl(provider?.config?.showCta ?? true, { nonNullable: true }),
      });
      this.providerForms.set(providerType, form);
    }
    return this.providerForms.get(providerType)!;
  }

  getProviderDisplayName(type: string): string {
    const names: Record<string, string> = {
      esnCard: 'ESN Card',
    };
    return names[type] || type;
  }

  getProviderDescription(type: string): string {
    const descriptions: Record<string, string> = {
      esnCard: 'Validate ESN cards and provide discounts to ESN members',
    };
    return descriptions[type] || `${type} discount provider`;
  }

  onProviderStatusChange(providerType: string, enabled: boolean): void {
    const form = this.getProviderForm(providerType);
    form.get('status')?.setValue(enabled ? 'enabled' : 'disabled');
  }

  saveSettings(): void {
    const providers = this.providersQuery.data();
    if (!providers) return;

    const updates = providers.map((provider: any) => {
      const form = this.getProviderForm(provider.type);
      return {
        type: provider.type,
        status: form.get('status')?.value || 'disabled',
        config: {
          ...provider.config,
          showCta: form.get('showCta')?.value ?? true,
        },
      };
    });

    this.updateMutation.mutate({ providers: updates });
  }
}