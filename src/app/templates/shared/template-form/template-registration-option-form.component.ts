import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../../core/trpc-client';
import { DurationSelectorComponent } from '../../../shared/components/controls/duration-selector/duration-selector.component';
import { RoleSelectComponent } from '../../../shared/components/controls/role-select/role-select.component';
import {
  RegistrationMode,
  TemplateRegistrationFormModel,
} from './template-registration-option-form.utilities';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DurationSelectorComponent,
    FormField,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    RoleSelectComponent,
  ],
  selector: 'app-template-registration-option-form',
  templateUrl: './template-registration-option-form.component.html',
})
export class TemplateRegistrationOptionFormComponent {
  public readonly registrationForm =
    input.required<FieldTree<TemplateRegistrationFormModel>>();
  public readonly registrationModes =
    input.required<readonly RegistrationMode[]>();

  private trpc = injectTRPC();
  protected readonly taxRatesQuery = injectQuery(() =>
    this.trpc.taxRates.listActive.queryOptions(),
  );
}
