import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
} from '@angular/core';
import { form, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';
import {
  mergeTemplateFormOverrides,
  RegistrationMode,
  TemplateFormData,
  TemplateFormOverrides,
  templateFormSchema,
  TemplateFormSubmitData,
} from '../shared/template-form/template-form.schema';
import { TemplateGeneralFormComponent } from '../shared/template-form/template-general-form.component';
import { TemplateRegistrationOptionFormComponent } from '../shared/template-form/template-registration-option-form.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    FontAwesomeModule,
    RouterLink,
    TemplateGeneralFormComponent,
    TemplateRegistrationOptionFormComponent,
  ],
  selector: 'app-template-create',
  styles: ``,
  templateUrl: './template-create.component.html',
})
export class TemplateCreateComponent {
  protected readonly categoryId = input<string | undefined>();
  private trpc = injectTRPC();
  protected readonly createTemplateMutation = injectMutation(() =>
    this.trpc.templates.createSimpleTemplate.mutationOptions(),
  );
  protected readonly faArrowLeft = faArrowLeft;
  private defaultOrganizerRolesQuery = injectQuery(() =>
    this.trpc.admin.roles.findMany.queryOptions({ defaultOrganizerRole: true }),
  );
  private defaultUserRolesQuery = injectQuery(() =>
    this.trpc.admin.roles.findMany.queryOptions({ defaultUserRole: true }),
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

  protected readonly registrationModes: RegistrationMode[] = [
    'fcfs',
    'random',
    'application',
  ];

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

  private queryClient = inject(QueryClient);
  private router = inject(Router);

  async onSubmit(event: Event) {
    event.preventDefault();
    await submit(this.templateForm, async (formState) => {
      const formValue = formState().value();
      if (!formValue.icon) {
        console.warn('[template-create] submit blocked: missing icon', {
          value: formValue,
        });
        return;
      }
      console.info('[template-create] submit', formValue);
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
      await this.createTemplateMutation.mutateAsync(payload, {
        onError: (error) => {
          console.error('[template-create] submit error', error);
        },
        onSuccess: async () => {
          console.info('[template-create] submit success');
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.templates.groupedByCategory.pathKey(),
          });
          this.router.navigate(['/templates']);
        },
      });
    });
  }
}
