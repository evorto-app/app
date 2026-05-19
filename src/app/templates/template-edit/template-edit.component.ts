import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
} from '@angular/core';
import { apply, form, schema, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import {
  mergeTemplateFormOverrides,
  TemplateFormData,
  TemplateFormOverrides,
  TemplateFormSubmitData,
} from '../shared/template-form/template-form.utilities';
import { TemplateGeneralFormComponent } from '../shared/template-form/template-general-form.component';
import { templateGeneralFormSchema } from '../shared/template-form/template-general-form.schema';
import { TemplateRegistrationOptionFormComponent } from '../shared/template-form/template-registration-option-form.component';
import { templateRegistrationOptionFormSchema } from '../shared/template-form/template-registration-option-form.schema';
import {
  RegistrationMode,
  toTemplateRegistrationSubmitData,
} from '../shared/template-form/template-registration-option-form.utilities';

const templateFormSchema = schema<TemplateFormData>((formPath) => {
  apply(formPath, templateGeneralFormSchema);
  apply(formPath.organizerRegistration, templateRegistrationOptionFormSchema);
  apply(formPath.participantRegistration, templateRegistrationOptionFormSchema);
});
const logger = consola.withTag('app/templates/edit');

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    FontAwesomeModule,
    RouterLink,
    TemplateGeneralFormComponent,
    TemplateRegistrationOptionFormComponent,
  ],
  selector: 'app-template-edit',
  styles: ``,
  templateUrl: './template-edit.component.html',
})
export class TemplateEditComponent {
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly registrationModes: readonly RegistrationMode[] = ['fcfs'];

  protected readonly templateId = input.required<string>();
  private readonly rpc = AppRpc.injectClient();

  protected readonly templateQuery = injectQuery(() =>
    this.rpc.templates.findOne.queryOptions({ id: this.templateId() }),
  );

  protected readonly simpleTemplateData = computed(() => {
    const templateData = this.templateQuery.data();
    if (!templateData) return templateData;
    const organizerRegistration =
      templateData.registrationOptions.find(
        (option) => option.organizingRegistration,
      ) ?? {};
    const participantRegistration =
      templateData.registrationOptions.find(
        (option) => !option.organizingRegistration,
      ) ?? {};
    return {
      ...templateData,
      organizerRegistration,
      participantRegistration,
    };
  });

  private readonly templateModel = linkedSignal<
    TemplateFormOverrides,
    TemplateFormData
  >({
    computation: (data, previous) =>
      mergeTemplateFormOverrides(data, previous?.value),
    source: () => this.simpleTemplateData() ?? {},
  });

  protected readonly templateForm = form(
    this.templateModel,
    templateFormSchema,
  );

  protected readonly updateTemplateMutation = injectMutation(() =>
    this.rpc.templates.updateSimpleTemplate.mutationOptions(),
  );

  private queryClient = inject(QueryClient);
  private router = inject(Router);

  async onSubmit(event: Event) {
    event.preventDefault();
    await submit(this.templateForm, async (formState) => {
      const formValue = formState().value();
      if (!formValue.icon) {
        logger.warn('Submit blocked: missing icon', {
          value: formValue,
        });
        return;
      }
      const id = this.templateId();
      const payload: TemplateFormSubmitData = {
        ...formValue,
        icon: formValue.icon,
        organizerRegistration: toTemplateRegistrationSubmitData(
          formValue.organizerRegistration,
        ),
        participantRegistration: toTemplateRegistrationSubmitData(
          formValue.participantRegistration,
        ),
      };
      await this.updateTemplateMutation.mutateAsync(
        { id, ...payload },
        {
          onSuccess: async () => {
            await this.queryClient.invalidateQueries({
              queryKey: this.rpc.templates.findOne.queryKey({ id }),
            });
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter(['templates', 'groupedByCategory']),
            );
            this.router.navigate(['/templates', id]);
          },
        },
      );
    });
  }
}
