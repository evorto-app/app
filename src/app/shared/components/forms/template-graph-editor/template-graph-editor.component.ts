import type { TaxRatesListActiveRecord } from '@shared/rpc-contracts/app-rpcs/tax-rates.rpcs';
import type { TemplateGraphRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FieldTree } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faPlus } from '@fortawesome/duotone-regular-svg-icons';
import { firstValueFrom } from 'rxjs';

import { persistedAdvancedToSimpleModeIssue } from '../registration-mode-transition';
import { OrdinaryTemplateGraphFormModel } from './ordinary-template-graph-form';
import { TemplateAddonEditorComponent } from './template-addon-editor.component';
import { isSimpleCompatibleRegistrationOptions } from './template-graph-form.mapper';
import {
  createTemplateGraphAddonFormModel,
  createTemplateGraphQuestionFormModel,
  createTemplateGraphRegistrationOptionFormModel,
} from './template-graph-form.model';
import {
  type TemplateConfigurationMode,
  type TemplateModeConfirmationData,
  TemplateModeConfirmationDialogComponent,
} from './template-mode-confirmation-dialog.component';
import { TemplateQuestionEditorComponent } from './template-question-editor.component';
import {
  TemplateRegistrationOptionEditorComponent,
  type TemplateTaxRateLoadState,
} from './template-registration-option-editor.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    MatButtonModule,
    TemplateAddonEditorComponent,
    TemplateQuestionEditorComponent,
    TemplateRegistrationOptionEditorComponent,
  ],
  selector: 'app-template-graph-editor',
  templateUrl: './template-graph-editor.component.html',
})
export class TemplateGraphEditorComponent {
  readonly defaultParticipantRoleIds = input<readonly string[]>([]);
  readonly esnEnabled = input(false);
  readonly graphForm =
    input.required<FieldTree<OrdinaryTemplateGraphFormModel>>();
  readonly persistedTemplate = input<TemplateGraphRecord>();
  readonly taxRates = input<readonly TaxRatesListActiveRecord[]>([]);
  readonly taxRateState = input<TemplateTaxRateLoadState>('loading');

  protected readonly faPlus = faPlus;
  protected readonly modeBlockMessage = signal('');
  protected readonly optionChoices = computed(() =>
    this.graphForm()()
      .value()
      .registrationOptions.map((option, index) => ({
        key: option.key,
        title: option.title.trim() || `Registration option ${index + 1}`,
      })),
  );
  protected readonly optionKindWarnings = computed(() => {
    const options = this.graphForm()().value().registrationOptions;
    const warnings: string[] = [];
    if (options.every((option) => !option.organizingRegistration)) {
      warnings.push(
        'No organizing option is configured. This is allowed, but nobody can register as an organizer through this template.',
      );
    }
    if (options.every((option) => option.organizingRegistration)) {
      warnings.push(
        'No non-organizing option is configured. This is allowed, but ordinary participants cannot register through this template.',
      );
    }
    return warnings;
  });

  private readonly dialog = inject(MatDialog);

  protected addAddOn(): void {
    const firstOptionKey = this.optionChoices()[0]?.key;
    this.updateModel((model) => ({
      ...model,
      addOns: [
        ...model.addOns,
        createTemplateGraphAddonFormModel(firstOptionKey),
      ],
    }));
  }

  protected addAddOnMapping(addOnIndex: number): void {
    this.updateModel((model) => {
      const addOn = model.addOns[addOnIndex];
      if (!addOn) return model;
      const mappedKeys = new Set(
        addOn.registrationOptions.map(
          (mapping) => mapping.registrationOptionKey,
        ),
      );
      const nextOption = model.registrationOptions.find(
        (option) => !mappedKeys.has(option.key),
      );
      if (!nextOption) return model;
      return {
        ...model,
        addOns: model.addOns.map((current, index) =>
          index === addOnIndex
            ? {
                ...current,
                registrationOptions: [
                  ...current.registrationOptions,
                  {
                    includedQuantity: 1,
                    optionalPurchaseQuantity: 0,
                    registrationOptionKey: nextOption.key,
                  },
                ],
              }
            : current,
        ),
      };
    });
  }

  protected addQuestion(): void {
    const firstOptionKey = this.optionChoices()[0]?.key;
    if (!firstOptionKey) return;
    this.updateModel((model) => ({
      ...model,
      questions: [
        ...model.questions,
        {
          ...createTemplateGraphQuestionFormModel(firstOptionKey),
          sortOrder: model.questions.length,
        },
      ],
    }));
  }

  protected addRegistrationOption(): void {
    this.updateModel((model) => ({
      ...model,
      registrationOptions: [
        ...model.registrationOptions,
        {
          ...createTemplateGraphRegistrationOptionFormModel(
            `Registration option ${model.registrationOptions.length + 1}`,
            20,
            false,
          ),
          roleIds: [...this.defaultParticipantRoleIds()],
        },
      ],
    }));
  }

  protected isSimpleMode(): boolean {
    return this.graphForm().simpleModeEnabled().value();
  }

  protected registrationReferenceCount(key: string): number {
    const model = this.graphForm()().value();
    return (
      model.questions.filter(
        (question) => question.registrationOptionKey === key,
      ).length +
      model.addOns.reduce(
        (count, addOn) =>
          count +
          addOn.registrationOptions.filter(
            (mapping) => mapping.registrationOptionKey === key,
          ).length,
        0,
      )
    );
  }

  protected removeAddOn(index: number): void {
    this.updateModel((model) => ({
      ...model,
      addOns: model.addOns.filter((_addOn, addOnIndex) => addOnIndex !== index),
    }));
  }

  protected removeAddOnMapping(addOnIndex: number, mappingIndex: number): void {
    this.updateModel((model) => ({
      ...model,
      addOns: model.addOns.map((addOn, index) =>
        index === addOnIndex
          ? {
              ...addOn,
              registrationOptions: addOn.registrationOptions.filter(
                (_mapping, currentIndex) => currentIndex !== mappingIndex,
              ),
            }
          : addOn,
      ),
    }));
  }

  protected removeQuestion(index: number): void {
    this.updateModel((model) => ({
      ...model,
      questions: model.questions.filter(
        (_question, questionIndex) => questionIndex !== index,
      ),
    }));
  }

  protected removeRegistrationOption(index: number): void {
    const option = this.graphForm()().value().registrationOptions[index];
    if (!option || this.registrationReferenceCount(option.key) > 0) return;
    this.updateModel((model) => ({
      ...model,
      registrationOptions: model.registrationOptions.filter(
        (_option, optionIndex) => optionIndex !== index,
      ),
    }));
  }

  protected async requestMode(targetMode: TemplateConfigurationMode) {
    const currentMode: TemplateConfigurationMode = this.isSimpleMode()
      ? 'simple'
      : 'advanced';
    if (currentMode === targetMode) return;

    if (targetMode === 'simple') {
      const registrationOptions =
        this.graphForm()().value().registrationOptions;
      if (!isSimpleCompatibleRegistrationOptions(registrationOptions)) {
        this.modeBlockMessage.set(
          'Simple configuration requires exactly one organizing and one non-organizing option. Reclassify or remove options first; nothing was deleted.',
        );
        return;
      }

      const persistedTransitionIssue = persistedAdvancedToSimpleModeIssue(
        this.persistedTemplate(),
        registrationOptions,
      );
      if (persistedTransitionIssue) {
        this.modeBlockMessage.set(persistedTransitionIssue);
        return;
      }
    }

    this.modeBlockMessage.set('');
    const result = await firstValueFrom(
      this.dialog
        .open<
          TemplateModeConfirmationDialogComponent,
          TemplateModeConfirmationData,
          TemplateConfigurationMode | undefined
        >(TemplateModeConfirmationDialogComponent, {
          data: { targetMode },
          maxWidth: '34rem',
        })
        .afterClosed(),
    );
    if (result !== targetMode) return;
    this.graphForm()
      .simpleModeEnabled()
      .value.set(targetMode === 'simple');
  }

  private updateModel(
    update: (
      model: OrdinaryTemplateGraphFormModel,
    ) => OrdinaryTemplateGraphFormModel,
  ): void {
    this.graphForm()().value.update(update);
  }
}
