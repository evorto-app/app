import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { form, FormField, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import type { Tenant } from '../../../types/custom/tenant';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import {
  initializedTenant,
  optionalTrimmed,
  tenantSettingsInteractionReady,
  tenantSettingsSaveDisabled,
  tenantSettingsShouldHydrate,
} from './settings-form';

interface LegalSettingsModel {
  legalNoticeText: string;
  legalNoticeUrl: string;
  termsText: string;
  termsUrl: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    RouterLink,
  ],
  selector: 'app-legal-settings',
  templateUrl: './legal-settings.component.html',
})
export class LegalSettingsComponent {
  protected readonly faArrowLeft = faArrowLeft;
  private readonly model = signal<LegalSettingsModel>({
    legalNoticeText: '',
    legalNoticeUrl: '',
    termsText: '',
    termsUrl: '',
  });
  protected readonly settingsForm = form(this.model);
  protected readonly settingsInteractionReady =
    tenantSettingsInteractionReady();
  protected readonly tenantSettingsSaveDisabled = tenantSettingsSaveDisabled;
  private readonly rpc = AppRpc.injectClient();
  protected readonly updateMutation = injectMutation(() =>
    this.rpc.admin.tenant.updateLegalSettings.mutationOptions(),
  );
  private readonly configService = inject(ConfigService);
  private readonly currentTenant = computed(() =>
    initializedTenant(this.configService),
  );
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);

  constructor() {
    effect(() => {
      this.hydrateFromTenant(this.currentTenant());
    });
  }

  public hasUnsavedSettingsChanges(): boolean {
    return this.settingsForm().dirty();
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (
      tenantSettingsSaveDisabled({
        formInvalid: this.settingsForm().invalid(),
        formSubmitting: this.settingsForm().submitting(),
        interactionReady: this.settingsInteractionReady(),
        mutationPending: this.updateMutation.isPending(),
      })
    ) {
      return;
    }

    await submit(this.settingsForm, async (formState) => {
      const settings = formState().value();
      try {
        await this.updateMutation.mutateAsync({
          legalNoticeText: optionalTrimmed(settings.legalNoticeText),
          legalNoticeUrl: optionalTrimmed(settings.legalNoticeUrl),
          termsText: optionalTrimmed(settings.termsText),
          termsUrl: optionalTrimmed(settings.termsUrl),
        });
        await this.queryClient.invalidateQueries({
          queryKey: this.rpc.pathKey(['config', 'tenant']),
        });
        this.settingsForm().reset();
        this.notifications.showSuccess('Legal settings updated');
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(
            error,
            'The legal pages could not be saved. Try again.',
            ['RpcBadRequestError', 'AdminTenantNotFoundError'],
          ),
        );
      }
    });
  }

  private hydrateFromTenant(tenant: Tenant): void {
    if (!tenantSettingsShouldHydrate(this.settingsForm().dirty())) {
      return;
    }
    untracked(() => {
      this.model.set({
        legalNoticeText: tenant.legalNoticeText ?? '',
        legalNoticeUrl: tenant.legalNoticeUrl ?? '',
        termsText: tenant.termsText ?? '',
        termsUrl: tenant.termsUrl ?? '',
      });
      this.settingsForm().reset();
    });
  }
}
