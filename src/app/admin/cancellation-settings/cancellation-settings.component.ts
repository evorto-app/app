import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { injectMutation, injectQuery } from '@tanstack/angular-query-experimental';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faBan } from '@fortawesome/duotone-regular-svg-icons';

import { injectTRPC } from '../../../core/trpc-client';
import { createDefaultTenantPolicies, TenantCancellationPolicies } from '../../../../types/cancellation';

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
    FontAwesomeModule,
  ],
  selector: 'app-cancellation-settings',
  template: `
    <div class="flex flex-col gap-6">
      <div class="flex items-center gap-4">
        <fa-duotone-icon [icon]="faBan" size="xl"></fa-duotone-icon>
        <h1 class="text-2xl font-semibold">Cancellation Policies</h1>
      </div>

      @if (policiesQuery.isPending()) {
        <div class="flex justify-center p-8">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      } @else if (policiesQuery.isError()) {
        <div class="bg-error-container text-on-error-container rounded-xl p-4">
          <p>Failed to load cancellation policies: {{ policiesQuery.error()?.message }}</p>
        </div>
      } @else {
        <form [formGroup]="policyForm" (ngSubmit)="onSave()" class="flex flex-col gap-6">
          <mat-card class="p-6">
            <mat-card-header>
              <mat-card-title>Default Policies</mat-card-title>
              <mat-card-subtitle>
                Configure default cancellation policies for all registration types
              </mat-card-subtitle>
            </mat-card-header>
            
            <mat-card-content class="pt-4">
              <div class="flex flex-col gap-4">
                <div class="flex items-center gap-4">
                  <mat-slide-toggle formControlName="useSinglePolicy">
                    Use single policy for all registration types
                  </mat-slide-toggle>
                </div>

                @if (useSinglePolicy()) {
                  <!-- Single policy configuration -->
                  <div formGroupName="singlePolicy" class="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-surface-variant rounded-lg">
                    <mat-form-field>
                      <mat-label>Cutoff Days</mat-label>
                      <input matInput type="number" formControlName="cutoffDays" min="0">
                      <mat-hint>Days before event when cancellation is no longer allowed</mat-hint>
                    </mat-form-field>

                    <mat-form-field>
                      <mat-label>Cutoff Hours</mat-label>
                      <input matInput type="number" formControlName="cutoffHours" min="0" max="23">
                      <mat-hint>Additional hours (0-23)</mat-hint>
                    </mat-form-field>

                    <div class="col-span-full flex flex-col gap-2">
                      <mat-checkbox formControlName="allowCancellation">
                        Allow cancellation
                      </mat-checkbox>
                      <mat-checkbox formControlName="includeTransactionFees">
                        Include transaction fees in refund
                      </mat-checkbox>
                      <mat-checkbox formControlName="includeAppFees">
                        Include app fees in refund
                      </mat-checkbox>
                    </div>
                  </div>
                } @else {
                  <!-- Per-variant configuration -->
                  <mat-expansion-panel-group>
                    <mat-expansion-panel>
                      <mat-expansion-panel-header>
                        <mat-panel-title>Paid Regular Registration</mat-panel-title>
                        <mat-panel-description>Default policy for paid participant registrations</mat-panel-description>
                      </mat-expansion-panel-header>
                      <div formGroupName="paid-regular" class="flex flex-col gap-4 pt-4">
                        <div class="grid grid-cols-2 gap-4">
                          <mat-form-field>
                            <mat-label>Cutoff Days</mat-label>
                            <input matInput type="number" formControlName="cutoffDays" min="0">
                          </mat-form-field>
                          <mat-form-field>
                            <mat-label>Cutoff Hours</mat-label>
                            <input matInput type="number" formControlName="cutoffHours" min="0" max="23">
                          </mat-form-field>
                        </div>
                        <div class="flex flex-col gap-2">
                          <mat-checkbox formControlName="allowCancellation">Allow cancellation</mat-checkbox>
                          <mat-checkbox formControlName="includeTransactionFees">Include transaction fees</mat-checkbox>
                          <mat-checkbox formControlName="includeAppFees">Include app fees</mat-checkbox>
                        </div>
                      </div>
                    </mat-expansion-panel>

                    <mat-expansion-panel>
                      <mat-expansion-panel-header>
                        <mat-panel-title>Paid Organizer Registration</mat-panel-title>
                        <mat-panel-description>Default policy for paid organizer registrations</mat-panel-description>
                      </mat-expansion-panel-header>
                      <div formGroupName="paid-organizer" class="flex flex-col gap-4 pt-4">
                        <div class="grid grid-cols-2 gap-4">
                          <mat-form-field>
                            <mat-label>Cutoff Days</mat-label>
                            <input matInput type="number" formControlName="cutoffDays" min="0">
                          </mat-form-field>
                          <mat-form-field>
                            <mat-label>Cutoff Hours</mat-label>
                            <input matInput type="number" formControlName="cutoffHours" min="0" max="23">
                          </mat-form-field>
                        </div>
                        <div class="flex flex-col gap-2">
                          <mat-checkbox formControlName="allowCancellation">Allow cancellation</mat-checkbox>
                          <mat-checkbox formControlName="includeTransactionFees">Include transaction fees</mat-checkbox>
                          <mat-checkbox formControlName="includeAppFees">Include app fees</mat-checkbox>
                        </div>
                      </div>
                    </mat-expansion-panel>

                    <mat-expansion-panel>
                      <mat-expansion-panel-header>
                        <mat-panel-title>Free Regular Registration</mat-panel-title>
                        <mat-panel-description>Default policy for free participant registrations</mat-panel-description>
                      </mat-expansion-panel-header>
                      <div formGroupName="free-regular" class="flex flex-col gap-4 pt-4">
                        <div class="grid grid-cols-2 gap-4">
                          <mat-form-field>
                            <mat-label>Cutoff Days</mat-label>
                            <input matInput type="number" formControlName="cutoffDays" min="0">
                          </mat-form-field>
                          <mat-form-field>
                            <mat-label>Cutoff Hours</mat-label>
                            <input matInput type="number" formControlName="cutoffHours" min="0" max="23">
                          </mat-form-field>
                        </div>
                        <div class="flex flex-col gap-2">
                          <mat-checkbox formControlName="allowCancellation">Allow cancellation</mat-checkbox>
                          <mat-checkbox formControlName="includeTransactionFees">Include transaction fees</mat-checkbox>
                          <mat-checkbox formControlName="includeAppFees">Include app fees</mat-checkbox>
                        </div>
                      </div>
                    </mat-expansion-panel>

                    <mat-expansion-panel>
                      <mat-expansion-panel-header>
                        <mat-panel-title>Free Organizer Registration</mat-panel-title>
                        <mat-panel-description>Default policy for free organizer registrations</mat-panel-description>
                      </mat-expansion-panel-header>
                      <div formGroupName="free-organizer" class="flex flex-col gap-4 pt-4">
                        <div class="grid grid-cols-2 gap-4">
                          <mat-form-field>
                            <mat-label>Cutoff Days</mat-label>
                            <input matInput type="number" formControlName="cutoffDays" min="0">
                          </mat-form-field>
                          <mat-form-field>
                            <mat-label>Cutoff Hours</mat-label>
                            <input matInput type="number" formControlName="cutoffHours" min="0" max="23">
                          </mat-form-field>
                        </div>
                        <div class="flex flex-col gap-2">
                          <mat-checkbox formControlName="allowCancellation">Allow cancellation</mat-checkbox>
                          <mat-checkbox formControlName="includeTransactionFees">Include transaction fees</mat-checkbox>
                          <mat-checkbox formControlName="includeAppFees">Include app fees</mat-checkbox>
                        </div>
                      </div>
                    </mat-expansion-panel>
                  </mat-expansion-panel-group>
                }
              </div>
            </mat-card-content>

            <mat-card-actions>
              <button 
                mat-raised-button 
                color="primary" 
                type="submit"
                [disabled]="policyForm.invalid || saveMutation.isPending()"
              >
                @if (saveMutation.isPending()) {
                  Saving...
                } @else {
                  Save Policies
                }
              </button>
            </mat-card-actions>
          </mat-card>
        </form>
      }
    </div>
  `,
})
export class CancellationSettingsComponent {
  private readonly trpc = injectTRPC();
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly faBan = faBan;

  protected readonly policiesQuery = injectQuery(() => 
    this.trpc.admin.tenant.getCancellationPolicies.queryOptions()
  );

  protected readonly saveMutation = injectMutation(() =>
    this.trpc.admin.tenant.setCancellationPolicies.mutationOptions()
  );

  protected readonly useSinglePolicy = signal(true);

  private readonly defaultPolicies = createDefaultTenantPolicies();

  protected readonly policyForm = this.fb.group({
    useSinglePolicy: [true],
    singlePolicy: this.fb.group({
      allowCancellation: [true, Validators.required],
      includeTransactionFees: [false, Validators.required],
      includeAppFees: [true, Validators.required],
      cutoffDays: [1, [Validators.required, Validators.min(0)]],
      cutoffHours: [0, [Validators.required, Validators.min(0), Validators.max(23)]],
    }),
    'paid-regular': this.fb.group({
      allowCancellation: [this.defaultPolicies['paid-regular'].allowCancellation, Validators.required],
      includeTransactionFees: [this.defaultPolicies['paid-regular'].includeTransactionFees, Validators.required],
      includeAppFees: [this.defaultPolicies['paid-regular'].includeAppFees, Validators.required],
      cutoffDays: [this.defaultPolicies['paid-regular'].cutoffDays, [Validators.required, Validators.min(0)]],
      cutoffHours: [this.defaultPolicies['paid-regular'].cutoffHours, [Validators.required, Validators.min(0), Validators.max(23)]],
    }),
    'paid-organizer': this.fb.group({
      allowCancellation: [this.defaultPolicies['paid-organizer'].allowCancellation, Validators.required],
      includeTransactionFees: [this.defaultPolicies['paid-organizer'].includeTransactionFees, Validators.required],
      includeAppFees: [this.defaultPolicies['paid-organizer'].includeAppFees, Validators.required],
      cutoffDays: [this.defaultPolicies['paid-organizer'].cutoffDays, [Validators.required, Validators.min(0)]],
      cutoffHours: [this.defaultPolicies['paid-organizer'].cutoffHours, [Validators.required, Validators.min(0), Validators.max(23)]],
    }),
    'free-regular': this.fb.group({
      allowCancellation: [this.defaultPolicies['free-regular'].allowCancellation, Validators.required],
      includeTransactionFees: [this.defaultPolicies['free-regular'].includeTransactionFees, Validators.required],
      includeAppFees: [this.defaultPolicies['free-regular'].includeAppFees, Validators.required],
      cutoffDays: [this.defaultPolicies['free-regular'].cutoffDays, [Validators.required, Validators.min(0)]],
      cutoffHours: [this.defaultPolicies['free-regular'].cutoffHours, [Validators.required, Validators.min(0), Validators.max(23)]],
    }),
    'free-organizer': this.fb.group({
      allowCancellation: [this.defaultPolicies['free-organizer'].allowCancellation, Validators.required],
      includeTransactionFees: [this.defaultPolicies['free-organizer'].includeTransactionFees, Validators.required],
      includeAppFees: [this.defaultPolicies['free-organizer'].includeAppFees, Validators.required],
      cutoffDays: [this.defaultPolicies['free-organizer'].cutoffDays, [Validators.required, Validators.min(0)]],
      cutoffHours: [this.defaultPolicies['free-organizer'].cutoffHours, [Validators.required, Validators.min(0), Validators.max(23)]],
    }),
  });

  constructor() {
    // Subscribe to form changes to update useSinglePolicy signal
    this.policyForm.get('useSinglePolicy')?.valueChanges.subscribe(value => {
      this.useSinglePolicy.set(value);
    });

    // Load existing policies when query succeeds
    this.policiesQuery.data.subscribe(data => {
      if (data) {
        this.loadPolicies(data);
      }
    });
  }

  private loadPolicies(policies: TenantCancellationPolicies) {
    // Check if all policies are the same (single policy mode)
    const variants = Object.values(policies);
    const isSinglePolicy = variants.every(policy => 
      JSON.stringify(policy) === JSON.stringify(variants[0])
    );

    this.useSinglePolicy.set(isSinglePolicy);
    this.policyForm.patchValue({
      useSinglePolicy: isSinglePolicy,
      singlePolicy: isSinglePolicy ? variants[0] : undefined,
      'paid-regular': policies['paid-regular'],
      'paid-organizer': policies['paid-organizer'],
      'free-regular': policies['free-regular'],
      'free-organizer': policies['free-organizer'],
    });
  }

  protected onSave() {
    if (this.policyForm.valid) {
      const formValue = this.policyForm.value;
      
      let policies: TenantCancellationPolicies;
      
      if (formValue.useSinglePolicy && formValue.singlePolicy) {
        // Apply single policy to all variants
        const singlePolicy = formValue.singlePolicy;
        policies = {
          'paid-regular': singlePolicy,
          'paid-organizer': singlePolicy,
          'free-regular': singlePolicy,
          'free-organizer': singlePolicy,
        } as TenantCancellationPolicies;
      } else {
        // Use individual policies
        policies = {
          'paid-regular': formValue['paid-regular']!,
          'paid-organizer': formValue['paid-organizer']!,
          'free-regular': formValue['free-regular']!,
          'free-organizer': formValue['free-organizer']!,
        } as TenantCancellationPolicies;
      }

      this.saveMutation.mutate(policies, {
        onSuccess: () => {
          this.snackBar.open('Cancellation policies saved successfully', 'Close', {
            duration: 3000,
          });
          this.policiesQuery.refetch();
        },
        onError: (error) => {
          this.snackBar.open(`Failed to save policies: ${error.message}`, 'Close', {
            duration: 5000,
          });
        },
      });
    }
  }
}