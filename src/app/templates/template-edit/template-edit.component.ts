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
import { EffectRpcQueryClient } from '@heddendorp/effect-angular-query';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';
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
import { RegistrationMode } from '../shared/template-form/template-registration-option-form.utilities';

const templateFormSchema = schema<TemplateFormData>((formPath) => {
  apply(formPath, templateGeneralFormSchema);
  apply(formPath.organizerRegistration, templateRegistrationOptionFormSchema);
  apply(formPath.participantRegistration, templateRegistrationOptionFormSchema);
});

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
  protected readonly registrationModes: RegistrationMode[] = [
    'fcfs',
    'random',
    'application',
  ];

  protected readonly templateId = input.required<string>();
  private trpc = injectTRPC();

  protected readonly templateQuery = injectQuery(() =>
    this.trpc.templates.findOne.queryOptions({ id: this.templateId() }),
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
    this.trpc.templates.updateSimpleTemplate.mutationOptions(),
  );

  private queryClient = inject(QueryClient);
  private router = inject(Router);
  private readonly rpcQueryClient = inject(EffectRpcQueryClient);

  async onSubmit(event: Event) {
    event.preventDefault();
    await submit(this.templateForm, async (formState) => {
      const formValue = formState().value();
      if (!formValue.icon) {
        console.warn('[template-edit] submit blocked: missing icon', {
          value: formValue,
        });
        return;
      }
      const id = this.templateId();
      const payload: TemplateFormSubmitData = {
        ...formValue,
        icon: formValue.icon,
        organizerRegistration: {
          closeRegistrationOffset:
            formValue.organizerRegistration.closeRegistrationOffset,
          isPaid: formValue.organizerRegistration.isPaid,
          openRegistrationOffset:
            formValue.organizerRegistration.openRegistrationOffset,
          price: formValue.organizerRegistration.price,
          registrationMode: formValue.organizerRegistration.registrationMode,
          roleIds: formValue.organizerRegistration.roleIds,
          spots: formValue.organizerRegistration.spots,
          stripeTaxRateId: formValue.organizerRegistration.stripeTaxRateId,
        },
        participantRegistration: {
          closeRegistrationOffset:
            formValue.participantRegistration.closeRegistrationOffset,
          isPaid: formValue.participantRegistration.isPaid,
          openRegistrationOffset:
            formValue.participantRegistration.openRegistrationOffset,
          price: formValue.participantRegistration.price,
          registrationMode: formValue.participantRegistration.registrationMode,
          roleIds: formValue.participantRegistration.roleIds,
          spots: formValue.participantRegistration.spots,
          stripeTaxRateId: formValue.participantRegistration.stripeTaxRateId,
        },
      };
      await this.updateTemplateMutation.mutateAsync(
        { id, ...payload },
        {
          onSuccess: async () => {
            await this.queryClient.invalidateQueries({
              queryKey: this.trpc.templates.findOne.queryKey({ id }),
            });
            await this.queryClient.invalidateQueries(
              this.rpcQueryClient.queryFilter([
                'templates',
                'groupedByCategory',
              ]),
            );
            this.router.navigate(['/templates', id]);
          },
        },
      );
    });
  }
}
