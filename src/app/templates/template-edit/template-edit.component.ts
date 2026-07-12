import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { form, FormField, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { TemplateEditIconUsage } from '@shared/rpc-contracts/app-rpcs/icons.rpcs';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import {
  createOrdinaryTemplateGraphFormModel,
  ordinaryTemplateGraphFormToPayload,
  ordinaryTemplateGraphRecordToFormModel,
} from '../../shared/components/forms/template-graph-editor/ordinary-template-graph-form';
import { ordinaryTemplateGraphFormSchemaWithPaymentAvailability } from '../../shared/components/forms/template-graph-editor/ordinary-template-graph-form.schema';
import { TemplateGraphEditorComponent } from '../../shared/components/forms/template-graph-editor/template-graph-editor.component';
import { resetTemplateGraphPayments } from '../../shared/components/forms/template-graph-editor/template-graph-form.model';
import { TemplateGeneralFormComponent } from '../shared/template-form/template-general-form.component';

const logger = consola.withTag('app/templates/edit');

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    FormField,
    MatButtonModule,
    MatCheckboxModule,
    RouterLink,
    TemplateGeneralFormComponent,
    TemplateGraphEditorComponent,
  ],
  selector: 'app-template-edit',
  templateUrl: './template-edit.component.html',
})
export class TemplateEditComponent {
  private readonly rpc = AppRpc.injectClient();
  protected readonly discountProvidersQuery = injectQuery(() =>
    this.rpc.discounts.getTenantProviders.queryOptions(),
  );
  protected readonly editorLoadError = signal('');
  private readonly config = inject(ConfigService);
  protected readonly stripeConnected = computed(() =>
    Boolean(this.config.tenantSignal()?.stripeAccountId),
  );
  private readonly templateModel = signal(
    createOrdinaryTemplateGraphFormModel(),
  );
  protected readonly templateForm = form(
    this.templateModel,
    ordinaryTemplateGraphFormSchemaWithPaymentAvailability(() =>
      this.stripeConnected(),
    ),
  );
  protected readonly templateId = input.required<string>();
  protected readonly templateQuery = injectQuery(() =>
    this.rpc.templates.findOne.queryOptions({ id: this.templateId() }),
  );
  protected readonly updateTemplateMutation = injectMutation(() =>
    this.rpc.templates.update.mutationOptions(),
  );
  private readonly defaultUserRolesQuery = injectQuery(() =>
    this.rpc.roles.findMany.queryOptions({ defaultUserRole: true }),
  );
  protected readonly canSubmit = computed(
    () =>
      this.templateQuery.isSuccess() &&
      this.defaultUserRolesQuery.isSuccess() &&
      this.discountProvidersQuery.isSuccess() &&
      !this.editorLoadError() &&
      !this.templateForm().invalid() &&
      !this.templateForm().submitting() &&
      !this.updateTemplateMutation.isPending(),
  );
  protected readonly defaultParticipantRoleIds = computed(() =>
    this.defaultUserRolesQuery.isSuccess()
      ? this.defaultUserRolesQuery.data().map((role) => role.id)
      : [],
  );
  protected readonly esnEnabled = computed(() => {
    if (!this.discountProvidersQuery.isSuccess()) return false;
    return (
      this.discountProvidersQuery
        .data()
        .find((provider) => provider.type === 'esnCard')?.status === 'enabled'
    );
  });
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly iconUsage = computed(() =>
    TemplateEditIconUsage.make({ templateId: this.templateId() }),
  );
  protected readonly stripeConnectionKnown = computed(
    () => this.config.tenantSignal() !== null,
  );
  protected readonly paidControlsUnavailable = computed(
    () => this.stripeConnectionKnown() && !this.stripeConnected(),
  );
  protected readonly taxRatesQuery = injectQuery(() =>
    this.rpc.taxRates.listActive.queryOptions(),
  );
  protected readonly taxRateState = computed(() =>
    this.taxRatesQuery.isPending()
      ? ('loading' as const)
      : this.taxRatesQuery.isError()
        ? ('error' as const)
        : ('ready' as const),
  );

  private readonly initializedTemplateId = signal<null | string>(null);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      const templateId = this.templateId();
      if (
        !this.templateQuery.isSuccess() ||
        this.initializedTemplateId() === templateId
      ) {
        return;
      }
      const result = ordinaryTemplateGraphRecordToFormModel(
        this.templateQuery.data(),
      );
      untracked(() => {
        if ('error' in result) {
          this.editorLoadError.set(result.error);
        } else {
          this.editorLoadError.set('');
          this.templateModel.set(
            this.paidControlsUnavailable()
              ? resetTemplateGraphPayments(result.model)
              : result.model,
          );
          this.templateForm().reset();
        }
        this.initializedTemplateId.set(templateId);
      });
    });
    effect(() => {
      if (!this.paidControlsUnavailable()) return;
      const model = this.templateModel();
      const resetModel = resetTemplateGraphPayments(model);
      if (resetModel === model) return;
      untracked(() => this.templateModel.set(resetModel));
    });
  }

  protected errorMessage(error: unknown): string {
    return getErrorMessage(error, 'Failed to update template');
  }

  protected async onSubmit(event: Event) {
    event.preventDefault();
    if (!this.canSubmit()) return;

    await submit(this.templateForm, async (formState) => {
      const value = this.paidControlsUnavailable()
        ? resetTemplateGraphPayments(formState().value())
        : formState().value();
      if (!value.icon || !this.discountProvidersQuery.isSuccess()) return;
      const payload = ordinaryTemplateGraphFormToPayload(
        { ...value, icon: value.icon },
        this.esnEnabled(),
      );
      try {
        const template = await this.updateTemplateMutation.mutateAsync({
          ...payload,
          id: this.templateId(),
        });
        await Promise.all([
          this.queryClient.invalidateQueries({
            queryKey: this.rpc.templates.findOne.queryKey({
              id: this.templateId(),
            }),
          }),
          this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['templates', 'groupedByCategory']),
          ),
        ]);
        logger.info('Template graph updated', { templateId: template.id });
        await this.router.navigate(['/templates', template.id]);
      } catch (error) {
        logger.error('Template graph update failed', error);
      }
    });
  }
}
