import type {
  AdminTenantBrandAssetKind,
  AdminTenantUpdateAppearanceSettingsInput,
} from '@shared/rpc-contracts/app-rpcs/admin.rpcs';

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
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft, faUpload } from '@fortawesome/duotone-regular-svg-icons';
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

interface AppearanceSettingsModel {
  faviconUrl: string;
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
        this.updateMutation.isPending(),
      uploadingBrandAsset: this.uploadingBrandAsset(),
    }),
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faUpload = faUpload;
  private readonly model = signal<AppearanceSettingsModel>({
    faviconUrl: '',
    logoUrl: '',
    seoDescription: '',
    seoTitle: '',
    theme: 'evorto',
  });
  protected readonly settingsForm = form(this.model);
  protected readonly settingsInteractionReady =
    tenantSettingsInteractionReady();
  protected readonly settingsSaveDisabled = computed(() =>
    appearanceSettingsSaveDisabled({
      formInvalid: this.settingsForm().invalid(),
      formSubmitting: this.settingsForm().submitting(),
      interactionReady: this.settingsInteractionReady(),
      mutationPending:
        this.uploadBrandAssetMutation.isPending() ||
        this.updateMutation.isPending(),
      uploadingBrandAsset: this.uploadingBrandAsset(),
    }),
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
    if (this.settingsSaveDisabled()) {
      return;
    }

    await submit(this.settingsForm, async (formState) => {
      const settings = formState().value();
      try {
        await this.updateMutation.mutateAsync({
          faviconUrl: optionalTrimmed(settings.faviconUrl),
          logoUrl: optionalTrimmed(settings.logoUrl),
          seoDescription: optionalTrimmed(settings.seoDescription),
          seoTitle: optionalTrimmed(settings.seoTitle),
          theme: settings.theme,
        });
        await this.queryClient.invalidateQueries({
          queryKey: this.rpc.pathKey(['config', 'tenant']),
        });
        this.settingsForm().reset();
        this.notifications.showSuccess('Appearance settings updated');
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(
            error,
            "We couldn't save the appearance settings. Try again.",
            ['RpcBadRequestError', 'AdminTenantNotFoundError'],
          ),
        );
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

  private hydrateFromTenant(tenant: Tenant): void {
    if (!tenantSettingsShouldHydrate(this.settingsForm().dirty())) {
      return;
    }
    untracked(() => {
      this.model.set({
        faviconUrl: tenant.faviconUrl ?? '',
        logoUrl: tenant.logoUrl ?? '',
        seoDescription: tenant.seoDescription ?? '',
        seoTitle: tenant.seoTitle ?? '',
        theme: tenant.theme,
      });
      this.settingsForm().reset();
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
