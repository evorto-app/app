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
import { injectMutation } from '@tanstack/angular-query-experimental';

import { GoogleLocationType } from '../../../types/location';
import { ConfigService } from '../../core/config.service';
import { injectTRPC } from '../../core/trpc-client';
import { LocationSelectorField } from '../../shared/components/controls/location-selector/location-selector-field/location-selector-field';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    RouterLink,
    MatButtonModule,
    MatSelectModule,
    ReactiveFormsModule,
    LocationSelectorField,
  ],
  selector: 'app-general-settings',
  styles: ``,
  templateUrl: './general-settings.component.html',
})
export class GeneralSettingsComponent {
  private readonly configService = inject(ConfigService);
  private readonly trpc = injectTRPC();
  protected readonly faArrowLeft = faArrowLeft;
  private readonly formBuilder = inject(NonNullableFormBuilder);
  protected readonly settingsForm = this.formBuilder.group({
    defaultLocation: this.formBuilder.control<GoogleLocationType | null>(null),
    theme: this.formBuilder.control<'esn' | 'evorto'>('evorto'),
  });
  private updateSettingsMutation = injectMutation(() =>
    this.trpc.admin.tenant.updateSettings.mutationOptions(),
  );

  constructor() {
    effect(() => {
      const currentTenant = this.configService.tenant;
      if (currentTenant) {
        this.settingsForm.patchValue({
          defaultLocation: currentTenant.defaultLocation,
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
