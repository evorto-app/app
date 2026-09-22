import type { ClientTenantConfig } from '@shared/rpc-contracts/app-rpcs/config.rpcs';

import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { disabled, form, FormField, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  type AdminTenantLegalSettingsSnapshot,
  adminTenantLegalSettingsSnapshot,
} from '@shared/tenant-settings-snapshot';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import {
  initializedTenant,
  isTenantSettingsConflict,
  optionalTrimmed,
  readTenantSettings,
  tenantSettingsInteractionReady,
  tenantSettingsSaveDenial,
  tenantSettingsSaveDisabled,
  type TenantSettingsSaveOutcome,
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
  protected readonly saveOutcome = signal<null | TenantSettingsSaveOutcome>(
    null,
  );
  protected readonly settingsPhase = signal<'reading' | 'saving' | null>(null);
  protected readonly settingsLocked = computed(
    () => this.settingsPhase() !== null || this.saveOutcome() !== null,
  );
  private readonly model = signal<LegalSettingsModel>({
    legalNoticeText: '',
    legalNoticeUrl: '',
    termsText: '',
    termsUrl: '',
  });
  protected readonly settingsForm = form(this.model, (settings) => {
    disabled(settings, () => this.settingsLocked());
  });
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
  private readonly document = inject(DOCUMENT);
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  // Signal Forms excludes disabled fields from its dirty state.
  private readonly retainedSettingsDirty = signal(false);
  private expectedSettings: AdminTenantLegalSettingsSnapshot | null = null;

  constructor() {
    effect(() => {
      this.hydrateFromTenant(this.currentTenant());
    });
  }

  public hasUnsavedSettingsChanges(): boolean {
    return this.retainedSettingsDirty() || this.settingsForm().dirty();
  }

  protected reloadSettings(): void {
    if (this.settingsPhase() !== null || this.saveOutcome() === null) return;
    this.document.defaultView?.location.reload();
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const expectedSettings = this.expectedSettings;
    if (
      !expectedSettings ||
      tenantSettingsSaveDisabled({
        formInvalid: this.settingsForm().invalid(),
        formSubmitting: this.settingsForm().submitting(),
        interactionReady: this.settingsInteractionReady(),
        mutationPending:
          this.updateMutation.isPending() || this.settingsLocked(),
      })
    ) {
      return;
    }

    await submit(this.settingsForm, async (formState) => {
      if (this.settingsLocked()) return;
      const settings = formState().value();
      this.retainedSettingsDirty.set(this.hasUnsavedSettingsChanges());
      this.settingsPhase.set('saving');
      try {
        try {
          await this.updateMutation.mutateAsync({
            expectedSettings,
            legalNoticeText: optionalTrimmed(settings.legalNoticeText),
            legalNoticeUrl: optionalTrimmed(settings.legalNoticeUrl),
            termsText: optionalTrimmed(settings.termsText),
            termsUrl: optionalTrimmed(settings.termsUrl),
          });
        } catch (error) {
          if (isTenantSettingsConflict(error)) {
            this.saveOutcome.set('stale');
            return;
          }
          const denial = tenantSettingsSaveDenial(error);
          if (denial) {
            this.notifications.showError(denial);
          } else {
            this.saveOutcome.set('unknown');
          }
          return;
        }
        this.settingsPhase.set('reading');
        try {
          const readState = await readTenantSettings(this.queryClient, [
            this.rpc.queryFilter(['config', 'tenant']),
          ]);
          if (readState === 'paused') {
            this.saveOutcome.set('saved-read-paused');
            return;
          }
        } catch {
          this.saveOutcome.set('saved-read-failed');
          return;
        }
        this.settingsForm().reset();
        this.retainedSettingsDirty.set(false);
        this.notifications.showSuccess('Legal settings updated');
      } finally {
        this.settingsPhase.set(null);
      }
    });
  }

  private hydrateFromTenant(tenant: ClientTenantConfig): void {
    if (
      this.settingsLocked() ||
      !tenantSettingsShouldHydrate(this.hasUnsavedSettingsChanges())
    ) {
      return;
    }
    untracked(() => {
      this.model.set({
        legalNoticeText: tenant.legalNoticeText ?? '',
        legalNoticeUrl: tenant.legalNoticeUrl ?? '',
        termsText: tenant.termsText ?? '',
        termsUrl: tenant.termsUrl ?? '',
      });
      this.expectedSettings = adminTenantLegalSettingsSnapshot(tenant);
      this.settingsForm().reset();
      this.retainedSettingsDirty.set(false);
    });
  }
}
