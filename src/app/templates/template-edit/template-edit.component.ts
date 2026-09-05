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
import { graphHasPaidConfiguration } from '../../shared/components/forms/payment-configuration';
import {
  createOrdinaryTemplateGraphFormModel,
  ordinaryTemplateGraphFormToPayload,
  ordinaryTemplateGraphRecordToFormModel,
} from '../../shared/components/forms/template-graph-editor/ordinary-template-graph-form';
import { ordinaryTemplateGraphFormSchemaWithPaymentAvailability } from '../../shared/components/forms/template-graph-editor/ordinary-template-graph-form.schema';
import { TemplateGraphEditorComponent } from '../../shared/components/forms/template-graph-editor/template-graph-editor.component';
import { TemplateGeneralFormComponent } from '../shared/template-form/template-general-form.component';

const logger = consola.withTag('app/templates/edit');

export const templateEditSaveErrorMessage = (error: unknown): string =>
  getErrorMessage(
    error,
    'The save outcome could not be confirmed. Load this template again to check the saved details before trying again.',
    ['RpcBadRequestError'],
  );

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
  protected readonly taxRatesQuery = injectQuery(() =>
    this.rpc.taxRates.listActive.queryOptions(),
  );
  protected readonly availableTaxRates = computed(() =>
    this.taxRatesQuery.isSuccess() && !this.taxRatesQuery.isFetching()
      ? this.taxRatesQuery.data()
      : undefined,
  );
  protected readonly discountProvidersQuery = injectQuery(() =>
    this.rpc.discounts.getTenantProviders.queryOptions(),
  );
  protected readonly discountProviderState = computed(() => {
    if (this.discountProvidersQuery.isError()) return 'error' as const;
    if (
      !this.discountProvidersQuery.isSuccess() ||
      this.discountProvidersQuery.isFetching()
    ) {
      return 'loading' as const;
    }
    return this.discountProvidersQuery
      .data()
      .some(
        (provider) =>
          provider.type === 'esnCard' && provider.status === 'enabled',
      )
      ? ('esnEnabled' as const)
      : ('ready' as const);
  });
  protected readonly authoringProvidersReady = computed(
    () =>
      (this.discountProviderState() === 'ready' ||
        this.discountProviderState() === 'esnEnabled') &&
      this.availableTaxRates() !== undefined,
  );
  protected readonly editorLoadError = signal('');
  private readonly config = inject(ConfigService);
  protected readonly stripeConnected = computed(() =>
    Boolean(this.config.tenantSignal()?.paymentsConfigured),
  );
  protected readonly stripeConnectionKnown = computed(
    () => this.config.tenantSignal() !== null,
  );
  protected readonly paidControlsUnavailable = computed(
    () => this.stripeConnectionKnown() && !this.stripeConnected(),
  );
  private readonly templateModel = signal(
    createOrdinaryTemplateGraphFormModel(),
  );
  protected readonly paidGraphBlocked = computed(
    () =>
      this.paidControlsUnavailable() &&
      graphHasPaidConfiguration(this.templateModel()),
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
  protected readonly rolesQuery = injectQuery(() =>
    this.rpc.roles.findMany.queryOptions({}),
  );
  protected readonly canSubmit = computed(
    () =>
      this.templateQuery.isSuccess() &&
      this.rolesQuery.isSuccess() &&
      this.authoringProvidersReady() &&
      !this.paidGraphBlocked() &&
      !this.editorLoadError() &&
      !this.templateForm().invalid() &&
      !this.templateForm().submitting() &&
      !this.updateTemplateMutation.isPending(),
  );
  protected readonly defaultParticipantRoleIds = computed(() =>
    this.rolesQuery.isSuccess()
      ? this.rolesQuery
          .data()
          .filter((role) => role.defaultUserRole)
          .map((role) => role.id)
      : [],
  );
  protected readonly esnEnabled = computed(
    () => this.discountProviderState() === 'esnEnabled',
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly iconUsage = computed(() =>
    TemplateEditIconUsage.make({ templateId: this.templateId() }),
  );
  protected readonly saveFollowUpMessage = signal('');
  protected readonly taxRateState = computed(() =>
    this.taxRatesQuery.isError()
      ? ('error' as const)
      : this.availableTaxRates() === undefined
        ? ('loading' as const)
        : ('ready' as const),
  );
  protected readonly updateErrorMessage = computed(() =>
    templateEditSaveErrorMessage(this.updateTemplateMutation.error()),
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
          this.templateModel.set(result.model);
          this.templateForm().reset();
        }
        this.initializedTemplateId.set(templateId);
      });
    });
  }

  protected async onSubmit(event: Event) {
    event.preventDefault();
    if (!this.canSubmit()) return;

    await submit(this.templateForm, async (formState) => {
      const value = formState().value();
      if (
        !value.icon ||
        !this.authoringProvidersReady() ||
        this.paidGraphBlocked()
      )
        return;
      const payload = ordinaryTemplateGraphFormToPayload(
        { ...value, icon: value.icon },
        this.esnEnabled(),
      );
      this.saveFollowUpMessage.set('');
      let saveStep: 'mutation' | 'navigation' | 'refresh' = 'mutation';
      try {
        const template = await this.updateTemplateMutation.mutateAsync({
          ...payload,
          id: this.templateId(),
        });
        saveStep = 'refresh';
        const updateResults = await Promise.allSettled([
          this.queryClient.invalidateQueries(
            {
              queryKey: this.rpc.templates.findOne.queryKey({
                id: this.templateId(),
              }),
            },
            { throwOnError: true },
          ),
          this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['templates', 'groupedByCategory']),
            { throwOnError: true },
          ),
        ]);
        const updateFailures: unknown[] = updateResults.flatMap((result) =>
          result.status === 'rejected' ? [result.reason] : [],
        );
        if (updateFailures.length > 0) {
          throw new AggregateError(
            updateFailures,
            'Could not load the saved template information',
          );
        }
        logger.info('Template graph updated', { templateId: template.id });
        saveStep = 'navigation';
        const navigated = await this.router.navigate([
          '/templates',
          template.id,
        ]);
        if (!navigated) {
          this.saveFollowUpMessage.set(
            'The template was saved, but its page could not be opened. Open it from the template list.',
          );
        }
      } catch (error) {
        if (saveStep === 'refresh') {
          this.saveFollowUpMessage.set(
            'The template was saved, but the latest template information could not be loaded. Load this template again to see the saved details.',
          );
        } else if (saveStep === 'navigation') {
          this.saveFollowUpMessage.set(
            'The template was saved, but its page could not be opened. Open it from the template list.',
          );
        }
        logger.error('Template graph update failed', error);
      }
    });
  }
}
