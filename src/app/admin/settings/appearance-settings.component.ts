import type {
  AdminTenantBrandAssetKind,
  AdminTenantUpdateAppearanceSettingsInput,
} from '@shared/rpc-contracts/app-rpcs/admin.rpcs';
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
import {
  applyEach,
  disabled,
  form,
  FormField,
  maxLength,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft, faUpload } from '@fortawesome/duotone-regular-svg-icons';
import {
  isTenantFooterHref,
  MAX_TENANT_FOOTER_LINKS,
  type TenantFooterLink,
} from '@shared/tenant-footer-links';
import {
  type AdminTenantAppearanceSettingsSnapshot,
  adminTenantAppearanceSettingsSnapshot,
} from '@shared/tenant-settings-snapshot';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { footerIconOptions } from '../../core/footer-icons';
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

interface AppearanceSettingsModel {
  faviconUrl: string;
  footerLinks: TenantFooterLink[];
  logoUrl: string;
  seoDescription: string;
  seoTitle: string;
  theme: AdminTenantUpdateAppearanceSettingsInput['theme'];
}

export const appearanceSettingsBrandAssetUploadDisabled = ({
  mutationPending,
  uploadingBrandAsset,
}: {
  mutationPending: boolean;
  uploadingBrandAsset: AdminTenantBrandAssetKind | null;
}): boolean => uploadingBrandAsset !== null || mutationPending;

export const appearanceSettingsSaveDisabled = ({
  formInvalid,
  formSubmitting,
  interactionReady,
  mutationPending,
  uploadingBrandAsset,
}: {
  formInvalid: boolean;
  formSubmitting: boolean;
  interactionReady: boolean;
  mutationPending: boolean;
  uploadingBrandAsset: AdminTenantBrandAssetKind | null;
}): boolean =>
  tenantSettingsSaveDisabled({
    formInvalid,
    formSubmitting,
    interactionReady,
    mutationPending: mutationPending || uploadingBrandAsset !== null,
  });

const tenantBrandAssetClientMaxSizeBytes = 5 * 1024 * 1024;
const tenantBrandAssetClientMimeTypes = {
  favicon: new Set([
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/vnd.microsoft.icon',
    'image/webp',
    'image/x-icon',
  ]),
  logo: new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']),
} satisfies Record<AdminTenantBrandAssetKind, ReadonlySet<string>>;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    RouterLink,
  ],
  selector: 'app-appearance-settings',
  templateUrl: './appearance-settings.component.html',
})
export class AppearanceSettingsComponent {
  protected readonly saveOutcome = signal<null | TenantSettingsSaveOutcome>(
    null,
  );
  protected readonly settingsPhase = signal<'reading' | 'saving' | null>(null);
  protected readonly settingsLocked = computed(
    () => this.settingsPhase() !== null || this.saveOutcome() !== null,
  );
  private readonly rpc = AppRpc.injectClient();
  protected readonly updateMutation = injectMutation(() =>
    this.rpc.admin.tenant.updateAppearanceSettings.mutationOptions(),
  );
  protected readonly uploadingBrandAsset =
    signal<AdminTenantBrandAssetKind | null>(null);
  private readonly uploadBrandAssetMutation = injectMutation(() =>
    this.rpc.admin.tenant.uploadBrandAsset.mutationOptions(),
  );
  protected readonly brandAssetUploadDisabled = computed(() =>
    appearanceSettingsBrandAssetUploadDisabled({
      mutationPending:
        this.uploadBrandAssetMutation.isPending() ||
        this.updateMutation.isPending() ||
        this.settingsLocked(),
      uploadingBrandAsset: this.uploadingBrandAsset(),
    }),
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faUpload = faUpload;
  protected readonly footerIconOptions = footerIconOptions;
  protected readonly maxFooterLinks = MAX_TENANT_FOOTER_LINKS;

  protected addFooterLink(): void {
    if (
      this.settingsLocked() ||
      this.model().footerLinks.length >= MAX_TENANT_FOOTER_LINKS
    )
      return;
    this.model.update((model) => ({
      ...model,
      footerLinks: [
        ...model.footerLinks,
        { href: '', icon: 'website', label: '' },
      ],
    }));
    this.settingsForm.footerLinks().markAsDirty();
  }
  protected removeFooterLink(index: number): void {
    if (this.settingsLocked()) return;
    this.model.update((model) => ({
      ...model,
      footerLinks: model.footerLinks.filter((_, i) => i !== index),
    }));
    this.settingsForm.footerLinks().markAsDirty();
  }

  private readonly model = signal<AppearanceSettingsModel>({
    faviconUrl: '',
    footerLinks: [],
    logoUrl: '',
    seoDescription: '',
    seoTitle: '',
    theme: 'evorto',
  });
  protected readonly settingsForm = form(this.model, (settings) => {
    disabled(settings, () => this.settingsLocked());
    applyEach(settings.footerLinks, (link) => {
      required(link.label, { message: 'Enter a link label.' });
      validate(link.label, ({ value }) =>
        value() && !value().trim()
          ? { kind: 'blank', message: 'Enter a link label.' }
          : undefined,
      );
      maxLength(link.label, 60);
      required(link.href, { message: 'Enter a web or email address.' });
      validate(link.href, ({ value }) =>
        isTenantFooterHref(value().trim())
          ? undefined
          : {
              kind: 'url',
              message:
                'Use an http://, https://, or mailto: address without credentials.',
            },
      );
    });
  });
  protected readonly settingsInteractionReady =
    tenantSettingsInteractionReady();
  protected readonly settingsSaveDisabled = computed(() =>
    appearanceSettingsSaveDisabled({
      formInvalid: this.settingsForm().invalid(),
      formSubmitting: this.settingsForm().submitting(),
      interactionReady: this.settingsInteractionReady(),
      mutationPending:
        this.uploadBrandAssetMutation.isPending() ||
        this.updateMutation.isPending() ||
        this.settingsLocked(),
      uploadingBrandAsset: this.uploadingBrandAsset(),
    }),
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
  private expectedSettings: AdminTenantAppearanceSettingsSnapshot | null = null;

  constructor() {
    effect(() => {
      this.hydrateFromTenant(this.currentTenant());
    });
  }

  public hasUnsavedSettingsChanges(): boolean {
    return (
      this.uploadingBrandAsset() !== null ||
      this.retainedSettingsDirty() ||
      this.settingsForm().dirty()
    );
  }

  protected reloadSettings(): void {
    if (this.settingsPhase() !== null || this.saveOutcome() === null) return;
    this.document.defaultView?.location.reload();
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const expectedSettings = this.expectedSettings;
    if (!expectedSettings || this.settingsSaveDisabled()) {
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
            faviconUrl: optionalTrimmed(settings.faviconUrl),
            footerLinks: settings.footerLinks.map((link) => ({
              ...link,
              href: link.href.trim(),
              label: link.label.trim(),
            })),
            logoUrl: optionalTrimmed(settings.logoUrl),
            seoDescription: optionalTrimmed(settings.seoDescription),
            seoTitle: optionalTrimmed(settings.seoTitle),
            theme: settings.theme,
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
        this.notifications.showSuccess('Appearance settings updated');
      } finally {
        this.settingsPhase.set(null);
      }
    });
  }

  protected async uploadBrandAsset(
    kind: AdminTenantBrandAssetKind,
    event: Event,
  ): Promise<void> {
    const input = event.target as HTMLInputElement | undefined;
    const file = input?.files?.[0] ?? null;
    if (!file) {
      return;
    }
    if (this.brandAssetUploadDisabled()) {
      if (input) {
        input.value = '';
      }
      return;
    }
    if (!tenantBrandAssetClientMimeTypes[kind].has(file.type)) {
      this.notifications.showError(
        'This image type cannot be used. Choose another image.',
      );
      if (input) {
        input.value = '';
      }
      return;
    }
    if (file.size === 0 || file.size > tenantBrandAssetClientMaxSizeBytes) {
      this.notifications.showError(
        'This image is empty or larger than 5 MB. Choose another image.',
      );
      if (input) {
        input.value = '';
      }
      return;
    }

    this.uploadingBrandAsset.set(kind);
    let fileBase64: string;
    try {
      fileBase64 = await this.readFileAsBase64(file);
    } catch {
      this.notifications.showError(
        "We couldn't read this image. Choose another file.",
      );
      this.uploadingBrandAsset.set(null);
      if (input) {
        input.value = '';
      }
      return;
    }

    try {
      const uploaded = await this.uploadBrandAssetMutation.mutateAsync({
        fileBase64,
        fileName: file.name,
        fileSizeBytes: file.size,
        kind,
        mimeType: file.type,
      });
      this.model.update((current) => ({
        ...current,
        [kind === 'logo' ? 'logoUrl' : 'faviconUrl']: uploaded.assetUrl,
      }));
      this.settingsForm().markAsDirty();
      this.notifications.showSuccess(
        kind === 'logo'
          ? 'Logo uploaded. Save appearance settings to publish it.'
          : 'Tab icon uploaded. Save appearance settings to publish it.',
      );
    } catch (error) {
      this.notifications.showError(
        getErrorMessage(error, "We couldn't upload this image. Try again.", [
          'RpcBadRequestError',
          'AdminTenantNotFoundError',
        ]),
      );
    } finally {
      this.uploadingBrandAsset.set(null);
      if (input) {
        input.value = '';
      }
    }
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
        faviconUrl: tenant.faviconUrl ?? '',
        footerLinks: [...(tenant.footerLinks ?? [])],
        logoUrl: tenant.logoUrl ?? '',
        seoDescription: tenant.seoDescription ?? '',
        seoTitle: tenant.seoTitle ?? '',
        theme: tenant.theme,
      });
      this.expectedSettings = adminTenantAppearanceSettingsSnapshot(tenant);
      this.settingsForm().reset();
      this.retainedSettingsDirty.set(false);
    });
  }

  private async readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('error', () => {
        reject(new Error('Brand image could not be read'));
      });
      reader.addEventListener('load', () => {
        if (typeof reader.result !== 'string') {
          reject(new Error('Brand image could not be read'));
          return;
        }
        const commaIndex = reader.result.indexOf(',');
        if (commaIndex === -1) {
          reject(new Error('Brand image could not be read'));
          return;
        }
        resolve(reader.result.slice(commaIndex + 1));
      });
      reader.readAsDataURL(file);
    });
  }
}
