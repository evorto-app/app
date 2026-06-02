import '@angular/compiler';
import { describe, expect, it } from 'vitest';

import {
  generalSettingsBrandAssetUploadDisabled,
  generalSettingsSaveDisabled,
} from './general-settings.component';

describe('generalSettingsSaveDisabled', () => {
  it('blocks tenant settings saves while invalid, submitting, or mutation-pending', () => {
    expect(
      generalSettingsSaveDisabled({
        brandAssetMutationPending: false,
        formInvalid: true,
        formSubmitting: false,
        mutationPending: false,
        uploadingBrandAsset: null,
      }),
    ).toBe(true);
    expect(
      generalSettingsSaveDisabled({
        brandAssetMutationPending: false,
        formInvalid: false,
        formSubmitting: true,
        mutationPending: false,
        uploadingBrandAsset: null,
      }),
    ).toBe(true);
    expect(
      generalSettingsSaveDisabled({
        brandAssetMutationPending: false,
        formInvalid: false,
        formSubmitting: false,
        mutationPending: true,
        uploadingBrandAsset: null,
      }),
    ).toBe(true);
    expect(
      generalSettingsSaveDisabled({
        brandAssetMutationPending: false,
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
        uploadingBrandAsset: null,
      }),
    ).toBe(false);
  });

  it('blocks tenant settings saves while a brand asset upload is active', () => {
    expect(
      generalSettingsSaveDisabled({
        brandAssetMutationPending: false,
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
        uploadingBrandAsset: 'logo',
      }),
    ).toBe(true);
    expect(
      generalSettingsSaveDisabled({
        brandAssetMutationPending: true,
        formInvalid: false,
        formSubmitting: false,
        mutationPending: false,
        uploadingBrandAsset: null,
      }),
    ).toBe(true);
  });
});

describe('generalSettingsBrandAssetUploadDisabled', () => {
  it('blocks brand asset uploads while any upload is active or mutation-pending', () => {
    expect(
      generalSettingsBrandAssetUploadDisabled({
        mutationPending: false,
        uploadingBrandAsset: 'logo',
      }),
    ).toBe(true);
    expect(
      generalSettingsBrandAssetUploadDisabled({
        mutationPending: true,
        uploadingBrandAsset: null,
      }),
    ).toBe(true);
    expect(
      generalSettingsBrandAssetUploadDisabled({
        mutationPending: false,
        uploadingBrandAsset: null,
      }),
    ).toBe(false);
  });
});
