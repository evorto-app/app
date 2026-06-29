import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faTrashCan } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../../core/effect-rpc-angular-client';
import { TemplateAddonFormModel } from './template-addon-form.utilities';
import { templateTaxRateOptionsMessage } from './template-registration-option-form.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  selector: 'app-template-addon-form',
  templateUrl: './template-addon-form.component.html',
})
export class TemplateAddonFormComponent {
  public readonly addOnForm = input<FieldTree<TemplateAddonFormModel> | null>(
    null,
  );
  public readonly remove = output();
  protected readonly faTrashCan = faTrashCan;

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
}
