import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
} from '@angular/core';
import { apply, applyEach, form, schema, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft, faPlus } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { TemplateAddonFormComponent } from '../shared/template-form/template-addon-form.component';
import { templateAddonFormSchema } from '../shared/template-form/template-addon-form.schema';
import {
  createTemplateAddonFormModel,
  toTemplateAddonSubmitData,
} from '../shared/template-form/template-addon-form.utilities';
import {
  mergeTemplateFormOverrides,
  TemplateFormData,
  TemplateFormOverrides,
  TemplateFormSubmitData,
  templateWriteSubmitDisabled,
} from '../shared/template-form/template-form.utilities';
import { TemplateGeneralFormComponent } from '../shared/template-form/template-general-form.component';
import { templateGeneralFormSchema } from '../shared/template-form/template-general-form.schema';
import { TemplateQuestionFormComponent } from '../shared/template-form/template-question-form.component';
import { templateQuestionFormSchema } from '../shared/template-form/template-question-form.schema';
import {
  createTemplateQuestionFormModel,
  toTemplateQuestionSubmitData,
} from '../shared/template-form/template-question-form.utilities';
import { TemplateRegistrationOptionFormComponent } from '../shared/template-form/template-registration-option-form.component';
import { templateRegistrationOptionFormSchema } from '../shared/template-form/template-registration-option-form.schema';
import {
  RegistrationMode,
  toTemplateRegistrationSubmitData,
} from '../shared/template-form/template-registration-option-form.utilities';

const templateFormSchema = schema<TemplateFormData>((formPath) => {
  apply(formPath, templateGeneralFormSchema);
  applyEach(formPath.addOns, templateAddonFormSchema);
  apply(formPath.organizerRegistration, templateRegistrationOptionFormSchema);
  apply(formPath.participantRegistration, templateRegistrationOptionFormSchema);
  applyEach(formPath.questions, templateQuestionFormSchema);
});
const logger = consola.withTag('app/templates/create');

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    FontAwesomeModule,
    RouterLink,
    TemplateAddonFormComponent,
    TemplateGeneralFormComponent,
    TemplateQuestionFormComponent,
    TemplateRegistrationOptionFormComponent,
  ],
  selector: 'app-template-create',
  styles: ``,
  templateUrl: './template-create.component.html',
})
export class TemplateCreateComponent {
  private readonly rpc = AppRpc.injectClient();
  protected readonly createTemplateMutation = injectMutation(() =>
    this.rpc.templates.createSimpleTemplate.mutationOptions(),
  );
  protected readonly discountProvidersQuery = injectQuery(() =>
    this.rpc.discounts.getTenantProviders.queryOptions(),
  );
  protected readonly categoryId = input<string | undefined>();
  private defaultOrganizerRolesQuery = injectQuery(() =>
    this.rpc.roles.findMany.queryOptions({
      defaultOrganizerRole: true,
    }),
  );
  private defaultUserRolesQuery = injectQuery(() =>
    this.rpc.roles.findMany.queryOptions({ defaultUserRole: true }),
  );
  protected readonly initialFormData = computed<TemplateFormOverrides>(() => ({
    categoryId: this.categoryId() || '',
    organizerRegistration: {
      roleIds:
        this.defaultOrganizerRolesQuery.data()?.map((role) => role.id) || [],
    },
    participantRegistration: {
      roleIds: this.defaultUserRolesQuery.data()?.map((role) => role.id) || [],
    },
  }));
  private readonly templateModel = linkedSignal<
    TemplateFormOverrides,
    TemplateFormData
  >({
    computation: (data, previous) =>
      mergeTemplateFormOverrides(data, previous?.value),
    source: () => this.initialFormData(),
  });
  protected readonly templateForm = form(
    this.templateModel,
    templateFormSchema,
  );

  protected readonly canSubmit = computed(
    () =>
      this.discountProvidersQuery.isSuccess() &&
      !templateWriteSubmitDisabled({
        formInvalid: this.templateForm().invalid(),
        formSubmitting: this.templateForm().submitting(),
        mutationPending: this.createTemplateMutation.isPending(),
      }),
  );

  protected readonly esnEnabled = computed(() => {
    if (!this.discountProvidersQuery.isSuccess()) return false;
    const providers = this.discountProvidersQuery.data();
    return (
      providers.find((provider) => provider.type === 'esnCard')?.status ===
      'enabled'
    );
  });

  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faPlus = faPlus;
  protected readonly registrationModes: readonly RegistrationMode[] = ['fcfs'];

  protected readonly templateWriteSubmitDisabled = templateWriteSubmitDisabled;
  private queryClient = inject(QueryClient);
  private router = inject(Router);

  async onSubmit(event: Event) {
    event.preventDefault();
    if (
      templateWriteSubmitDisabled({
        formInvalid: false,
        formSubmitting: this.templateForm().submitting(),
        mutationPending: this.createTemplateMutation.isPending(),
      })
    ) {
      return;
    }

    await submit(this.templateForm, async (formState) => {
      const formValue = formState().value();
      if (!formValue.icon) {
        logger.warn('Submit blocked: missing icon', {
          value: formValue,
        });
        return;
      }
      if (!this.discountProvidersQuery.isSuccess()) {
        logger.warn('Submit blocked: discount providers are not loaded');
        return;
      }
      logger.info('Submit template create form', formValue);
      const payload: TemplateFormSubmitData = {
        ...formValue,
        addOns: formValue.addOns.map((addOn) =>
          toTemplateAddonSubmitData(addOn),
        ),
        icon: formValue.icon,
        organizerRegistration: toTemplateRegistrationSubmitData(
          formValue.organizerRegistration,
          { esnEnabled: this.esnEnabled() },
        ),
        participantRegistration: toTemplateRegistrationSubmitData(
          formValue.participantRegistration,
          { esnEnabled: this.esnEnabled() },
        ),
        questions: formValue.questions.map((question) =>
          toTemplateQuestionSubmitData(question),
        ),
      };
      await this.createTemplateMutation.mutateAsync(payload, {
        onError: (error) => {
          logger.error('Template create failed', error);
        },
        onSuccess: async (template) => {
          logger.info('Template create succeeded');
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['templates', 'groupedByCategory']),
          );
          this.router.navigate(['/templates', template.id]);
        },
      });
    });
  }

  protected addTemplateAddOn() {
    this.templateModel.update((model) => ({
      ...model,
      addOns: [...model.addOns, createTemplateAddonFormModel()],
    }));
  }

  protected addTemplateQuestion() {
    this.templateModel.update((model) => ({
      ...model,
      questions: [...model.questions, createTemplateQuestionFormModel()],
    }));
  }

  protected removeTemplateAddOn(index: number) {
    this.templateModel.update((model) => ({
      ...model,
      addOns: model.addOns.filter((_, addOnIndex) => addOnIndex !== index),
    }));
  }

  protected removeTemplateQuestion(index: number) {
    this.templateModel.update((model) => ({
      ...model,
      questions: model.questions.filter(
        (_, questionIndex) => questionIndex !== index,
      ),
    }));
  }
}
