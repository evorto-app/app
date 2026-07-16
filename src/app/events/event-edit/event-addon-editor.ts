import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { injectQuery } from '@tanstack/angular-query-experimental';

import type { EventGraphAddonFormModel } from './event-graph-form.model';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { CurrencyAmountInputComponent } from '../../shared/components/controls/currency-amount-input/currency-amount-input.component';
import { EditorComponent } from '../../shared/components/controls/editor/editor.component';

export interface EventGraphOptionChoice {
  key: string;
  title: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyAmountInputComponent,
    EditorComponent,
    FormField,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  selector: 'app-event-addon-editor',
  templateUrl: './event-addon-editor.html',
})
export class EventAddonEditor {
  readonly addMappingRequested = output();
  readonly addOnForm = input.required<FieldTree<EventGraphAddonFormModel>>();
  readonly currencyCode = input.required<string>();
  readonly optionChoices = input.required<readonly EventGraphOptionChoice[]>();
  readonly removeMappingRequested = output<number>();
  readonly removeRequested = output();

  private readonly rpc = AppRpc.injectClient();
  protected readonly taxRatesQuery = injectQuery(() =>
    this.rpc.taxRates.listActive.queryOptions(),
  );

  protected canAddMapping(): boolean {
    const mappedKeys = new Set(
      this.addOnForm()()
        .value()
        .registrationOptions.map((mapping) => mapping.registrationOptionKey),
    );
    return this.optionChoices().some((option) => !mappedKeys.has(option.key));
  }

  protected optionUnavailableForMapping(
    mappingIndex: number,
    optionKey: string,
  ): boolean {
    return this.addOnForm()()
      .value()
      .registrationOptions.some(
        (mapping, index) =>
          index !== mappingIndex && mapping.registrationOptionKey === optionKey,
      );
  }
}
