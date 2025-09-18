import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { injectMutation, injectQuery } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';
import type { CancellationPolicy, PolicyVariant, TenantCancellationPolicies } from '../../../types/cancellation';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatCheckboxModule,
    MatSlideToggleModule,
    MatExpansionModule,
  ],
  selector: 'app-cancellation-settings',
  templateUrl: './cancellation-settings.component.html',
})
export class CancellationSettingsComponent {
  private readonly fb = new FormBuilder();
  private readonly trpc = injectTRPC();
  private readonly snackBar = inject(MatSnackBar);

  // Form state
  protected readonly applyToAllMode = signal(true);
  protected readonly showAdvanced = signal(false);

  // Queries and mutations
  protected readonly policiesQuery = injectQuery(() =>
    this.trpc.admin.tenant.getCancellationPolicies.queryOptions()
  );

  private readonly updatePoliciesMutation = injectMutation(() =>
    this.trpc.admin.tenant.setCancellationPolicies.mutationOptions()
  );

  protected get updatePoliciesPending(): boolean {
    return this.updatePoliciesMutation.isPending();
  }

  // Form
  protected readonly commonForm = this.fb.nonNullable.group({
    allowCancellation: [true, Validators.required],
    includeTransactionFees: [false, Validators.required],
    includeAppFees: [true, Validators.required],
    cutoffDays: [7, [Validators.required, Validators.min(0)]],
    cutoffHours: [0, [Validators.required, Validators.min(0), Validators.max(23)]],
  });

  protected readonly variantForms = {
    'paid-regular': this.fb.nonNullable.group({
      allowCancellation: [true, Validators.required],
      includeTransactionFees: [false, Validators.required],
      includeAppFees: [true, Validators.required],
      cutoffDays: [7, [Validators.required, Validators.min(0)]],
      cutoffHours: [0, [Validators.required, Validators.min(0), Validators.max(23)]],
    }),
    'paid-organizer': this.fb.nonNullable.group({
      allowCancellation: [true, Validators.required],
      includeTransactionFees: [false, Validators.required],
      includeAppFees: [true, Validators.required],
      cutoffDays: [7, [Validators.required, Validators.min(0)]],
      cutoffHours: [0, [Validators.required, Validators.min(0), Validators.max(23)]],
    }),
    'free-regular': this.fb.nonNullable.group({
      allowCancellation: [true, Validators.required],
      includeTransactionFees: [false, Validators.required],
      includeAppFees: [false, Validators.required],
      cutoffDays: [1, [Validators.required, Validators.min(0)]],
      cutoffHours: [0, [Validators.required, Validators.min(0), Validators.max(23)]],
    }),
    'free-organizer': this.fb.nonNullable.group({
      allowCancellation: [true, Validators.required],
      includeTransactionFees: [false, Validators.required],
      includeAppFees: [false, Validators.required],
      cutoffDays: [1, [Validators.required, Validators.min(0)]],
      cutoffHours: [0, [Validators.required, Validators.min(0), Validators.max(23)]],
    }),
  } as const;

  protected readonly isLoading = computed(() => this.policiesQuery.isFetching());
  protected readonly hasData = computed(() => !!this.policiesQuery.data());

  constructor() {
    // Load existing policies when data is available
    effect(() => {
      const data = this.policiesQuery.data();
      if (data?.policies) {
        this.loadPolicies(data.policies);
      }
    });
  }

  private loadPolicies(policies: TenantCancellationPolicies): void {
    // Check if we can use "apply to all" mode (all variants are the same)
    const variants: PolicyVariant[] = ['paid-regular', 'paid-organizer', 'free-regular', 'free-organizer'];
    const firstPolicy = policies[variants[0]];
    const allSame = variants.every(variant => {
      const policy = policies[variant];
      return JSON.stringify(policy) === JSON.stringify(firstPolicy);
    });

    if (allSame && firstPolicy) {
      this.applyToAllMode.set(true);
      this.commonForm.patchValue(firstPolicy);
    } else {
      this.applyToAllMode.set(false);
      this.showAdvanced.set(true);
      
      // Load individual variant policies
      variants.forEach(variant => {
        const policy = policies[variant];
        if (policy) {
          this.variantForms[variant].patchValue(policy);
        }
      });
    }
  }

  protected toggleMode(): void {
    const newMode = !this.applyToAllMode();
    this.applyToAllMode.set(newMode);
    
    if (newMode) {
      // Copy common form values to all variants
      const commonValues = this.commonForm.value as CancellationPolicy;
      Object.values(this.variantForms).forEach(form => {
        form.patchValue(commonValues);
      });
    }
  }

  protected savePolicies(): void {
    if (this.updatePoliciesMutation.isPending()) return;

    let input: any;

    if (this.applyToAllMode()) {
      if (this.commonForm.invalid) {
        this.commonForm.markAllAsTouched();
        return;
      }
      
      input = {
        applyToAll: true,
        policy: this.commonForm.value as CancellationPolicy,
      };
    } else {
      // Validate all variant forms
      const allValid = Object.values(this.variantForms).every(form => {
        if (form.invalid) {
          form.markAllAsTouched();
          return false;
        }
        return true;
      });

      if (!allValid) return;

      const overrides: TenantCancellationPolicies = {};
      const variants: PolicyVariant[] = ['paid-regular', 'paid-organizer', 'free-regular', 'free-organizer'];
      variants.forEach(variant => {
        overrides[variant] = this.variantForms[variant].value as CancellationPolicy;
      });

      input = {
        applyToAll: false,
        policy: this.commonForm.value as CancellationPolicy, // Required but not used
        overrides,
      };
    }

    this.updatePoliciesMutation.mutate(input, {
      onSuccess: () => {
        this.snackBar.open('Cancellation policies updated successfully', 'Close', {
          duration: 3000,
        });
        this.policiesQuery.refetch();
      },
      onError: (error) => {
        this.snackBar.open(`Failed to update policies: ${error.message}`, 'Close', {
          duration: 5000,
        });
      },
    });
  }

  protected getVariantForm(variant: string) {
    return this.variantForms[variant as PolicyVariant];
  }

  protected getVariantAllowsCancellation(variant: string): boolean {
    const form = this.variantForms[variant as PolicyVariant];
    const control = form.controls['allowCancellation'];
    return control?.value === true;
  }

  protected getVariantLabel(variant: string): string {
    switch (variant as PolicyVariant) {
      case 'paid-regular': return 'Paid - Regular participants';
      case 'paid-organizer': return 'Paid - Organizers';
      case 'free-regular': return 'Free - Regular participants';
      case 'free-organizer': return 'Free - Organizers';
    }
  }
}