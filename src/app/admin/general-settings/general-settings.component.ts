import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    RouterLink,
    MatButtonModule,
    MatSelectModule,
    ReactiveFormsModule,
  ],
  selector: 'app-general-settings',
  styles: ``,
  templateUrl: './general-settings.component.html',
})
export class GeneralSettingsComponent {
  private readonly queries = inject(QueriesService);
  protected currentTenantQuery = injectQuery(this.queries.currentTenant());
  protected readonly faArrowLeft = faArrowLeft;
  private readonly formBuilder = inject(NonNullableFormBuilder);
  protected readonly settingsForm = this.formBuilder.group({
    theme: this.formBuilder.control<'esn' | 'evorto'>('evorto'),
  });
  private updateSettingsMutation = injectMutation(
    this.queries.updateTenantSettings(),
  );

  constructor() {
    effect(() => {
      const currentTenant = this.currentTenantQuery.data();
      if (currentTenant) {
        this.settingsForm.patchValue({
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
    this.updateSettingsMutation.mutate(settings);
  }
}
