import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import {
  MatCheckboxChange,
  MatCheckboxModule,
} from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { registrationModeLabel } from '@shared/registration-modes';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../../core/effect-rpc-angular-client';
import { DurationSelectorComponent } from '../../../shared/components/controls/duration-selector/duration-selector.component';
import { EditorComponent } from '../../../shared/components/controls/editor/editor.component';
import { RoleSelectComponent } from '../../../shared/components/controls/role-select/role-select.component';
import {
  RegistrationMode,
  TemplateRegistrationFormModel,
} from './template-registration-option-form.utilities';

export const templateTaxRateOptionsMessage = ({
  isPending,
  isSuccess,
  rateCount,
}: {
  isPending: boolean;
  isSuccess: boolean;
  rateCount: number;
}): null | string => {
  if (isPending) return 'Loading tax rates ...';
  if (isSuccess && rateCount === 0) {
    return 'No active inclusive tax rates available';
  }
  if (!isSuccess) return 'Failed to load tax rates';
  return null;
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DurationSelectorComponent,
    EditorComponent,
    FormField,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    RoleSelectComponent,
  ],
  selector: 'app-template-registration-option-form',
  templateUrl: './template-registration-option-form.component.html',
})
export class TemplateRegistrationOptionFormComponent {
  public readonly esnEnabled = input.required<boolean>();
  public readonly registrationForm =
    input.required<FieldTree<TemplateRegistrationFormModel>>();
  public readonly registrationModes =
    input.required<readonly RegistrationMode[]>();
  protected readonly registrationModeLabel = registrationModeLabel;
  private readonly rpc = AppRpc.injectClient();
  protected readonly taxRatesQuery = injectQuery(() =>
    this.rpc.taxRates.listActive.queryOptions(),
  );
  protected readonly taxRateOptionsMessage = computed(() =>
    templateTaxRateOptionsMessage({
      isPending: this.taxRatesQuery.isPending(),
      isSuccess: this.taxRatesQuery.isSuccess(),
      rateCount: this.taxRatesQuery.data()?.length ?? 0,
    }),
  );

  protected setIsPaid(event: MatCheckboxChange): void {
    this.updateRegistrationForm({
      isPaid: event.checked,
    });
  }

  private updateRegistrationForm(
    updates: Partial<TemplateRegistrationFormModel>,
  ): void {
    this.registrationForm()().value.update((registration) => ({
      ...registration,
      ...updates,
    }));
  }
}
