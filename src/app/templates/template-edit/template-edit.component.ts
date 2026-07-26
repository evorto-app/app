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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  eventListingAudienceDescriptions,
  eventListingAudienceLabels,
  eventListingAudiences,
} from '@shared/event-listing-audience';
import { TemplateEditIconUsage } from '@shared/rpc-contracts/app-rpcs/icons.rpcs';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
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

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatSelectModule,
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
    Boolean(this.config.tenantSignal()?.stripeAccountId),
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
  protected readonly rolesQuery = injectQuery(() =>
    this.rpc.roles.findMany.queryOptions({}),
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
  protected readonly eventListingAudienceDescriptions =
    eventListingAudienceDescriptions;
  protected readonly eventListingAudienceLabels = eventListingAudienceLabels;
  protected readonly eventListingAudiences = eventListingAudiences;
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly iconUsage = computed(() =>
    TemplateEditIconUsage.make({ templateId: this.templateId() }),
  );
  protected readonly taxRateState = computed(() =>
    this.taxRatesQuery.isError()
      ? ('error' as const)
      : this.availableTaxRates() === undefined
        ? ('loading' as const)
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
      if (!value.icon || !this.authoringProvidersReady()) return;
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
