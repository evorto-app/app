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
import { form, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { TemplateCreateIconUsage } from '@shared/rpc-contracts/app-rpcs/icons.rpcs';
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
} from '../../shared/components/forms/template-graph-editor/ordinary-template-graph-form';
import { ordinaryTemplateGraphFormSchemaWithPaymentAvailability } from '../../shared/components/forms/template-graph-editor/ordinary-template-graph-form.schema';
import { TemplateGraphEditorComponent } from '../../shared/components/forms/template-graph-editor/template-graph-editor.component';
import { TemplateGeneralFormComponent } from '../shared/template-form/template-general-form.component';

const logger = consola.withTag('app/templates/create');

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    MatButtonModule,
    RouterLink,
    TemplateGeneralFormComponent,
    TemplateGraphEditorComponent,
  ],
  selector: 'app-template-create',
  templateUrl: './template-create.component.html',
})
export class TemplateCreateComponent {
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
  protected readonly createTemplateMutation = injectMutation(() =>
    this.rpc.templates.create.mutationOptions(),
  );
  protected readonly rolesQuery = injectQuery(() =>
    this.rpc.roles.findMany.queryOptions({}),
  );
  protected readonly defaultsReady = computed(() =>
    this.rolesQuery.isSuccess(),
  );
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
  protected readonly templateForm = form(
    this.templateModel,
    ordinaryTemplateGraphFormSchemaWithPaymentAvailability(() =>
      this.stripeConnected(),
    ),
  );
  protected readonly canSubmit = computed(
    () =>
      this.defaultsReady() &&
      this.authoringProvidersReady() &&
      !this.paidGraphBlocked() &&
      !this.templateForm().invalid() &&
      !this.templateForm().submitting() &&
      !this.createTemplateMutation.isPending(),
  );
  protected readonly categoryId = input<string>();
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
  protected readonly iconUsage = TemplateCreateIconUsage.make({});
  protected readonly taxRateState = computed(() =>
    this.taxRatesQuery.isError()
      ? ('error' as const)
      : this.availableTaxRates() === undefined
        ? ('loading' as const)
        : ('ready' as const),
  );

  private readonly initializedDefaults = signal(false);
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      if (!this.rolesQuery.isSuccess() || this.initializedDefaults()) {
        return;
      }
      const roles = this.rolesQuery.data();
      const organizerRoleIds = roles
        .filter((role) => role.defaultOrganizerRole)
        .map((role) => role.id);
      const participantRoleIds = roles
        .filter((role) => role.defaultUserRole)
        .map((role) => role.id);
      const categoryId = this.categoryId() ?? '';
      untracked(() => {
        this.templateModel.update((model) => ({
          ...model,
          categoryId,
          registrationOptions: model.registrationOptions.map((option) => ({
            ...option,
            roleIds: option.organizingRegistration
              ? organizerRoleIds
              : participantRoleIds,
          })),
        }));
        this.templateForm().reset();
        this.initializedDefaults.set(true);
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
        const template = await this.createTemplateMutation.mutateAsync(payload);
        await this.queryClient.invalidateQueries(
          this.rpc.queryFilter(['templates', 'groupedByCategory']),
        );
        logger.info('Template graph created', { templateId: template.id });
        await this.router.navigate(['/templates', template.id]);
      } catch (error) {
        logger.error('Template graph create failed', error);
      }
    });
  }
}
