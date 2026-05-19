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
const logger = consola.withTag('app/templates/create');

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
  private readonly rpc = AppRpc.injectClient();
  protected readonly createTemplateMutation = injectMutation(() =>
    this.rpc.templates.createSimpleTemplate.mutationOptions(),
  );
  protected readonly discountProvidersQuery = injectQuery(() =>
    this.rpc.discounts.getTenantProviders.queryOptions(),
  );
  protected readonly esnEnabled = computed(() => {
    const providers = this.discountProvidersQuery.data();
    if (!providers) return false;
    return (
      providers.find((provider) => provider.type === 'esnCard')?.status ===
      'enabled'
    );
  });
  protected readonly faArrowLeft = faArrowLeft;
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

  protected readonly registrationModes: readonly RegistrationMode[] = ['fcfs'];

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
        logger.warn('Submit blocked: missing icon', {
          value: formValue,
        });
        return;
      }
      logger.info('Submit template create form', formValue);
      const payload: TemplateFormSubmitData = {
        ...formValue,
        icon: formValue.icon,
        organizerRegistration: toTemplateRegistrationSubmitData(
          formValue.organizerRegistration,
          { esnEnabled: this.esnEnabled() },
        ),
        participantRegistration: toTemplateRegistrationSubmitData(
          formValue.participantRegistration,
          { esnEnabled: this.esnEnabled() },
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
}
