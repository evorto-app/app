import { describe, expect, it } from 'vitest';

import {
  appearanceSettingsBrandAssetUploadDisabled,
  appearanceSettingsSaveDisabled,
} from './appearance-settings.component';

describe('appearanceSettingsBrandAssetUploadDisabled', () => {
  it('blocks brand asset uploads while any upload or settings save is active', () => {
    expect(
      appearanceSettingsBrandAssetUploadDisabled({
        mutationPending: false,
        uploadingBrandAsset: 'logo',
      }),
    ).toBe(true);
    expect(
      appearanceSettingsBrandAssetUploadDisabled({
        mutationPending: true,
        uploadingBrandAsset: null,
      }),
    ).toBe(true);
    expect(
      appearanceSettingsBrandAssetUploadDisabled({
        mutationPending: false,
        uploadingBrandAsset: null,
      }),
    ).toBe(false);
  });
});

describe('appearanceSettingsSaveDisabled', () => {
  it('blocks saves until an in-flight brand upload has finished', () => {
    expect(
      appearanceSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        interactionReady: true,
        mutationPending: false,
        uploadingBrandAsset: 'favicon',
      }),
    ).toBe(true);
    expect(
      appearanceSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        interactionReady: true,
        mutationPending: true,
        uploadingBrandAsset: null,
      }),
    ).toBe(true);
    expect(
      appearanceSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        interactionReady: true,
        mutationPending: false,
        uploadingBrandAsset: null,
      }),
    ).toBe(false);
    expect(
      appearanceSettingsSaveDisabled({
        formInvalid: false,
        formSubmitting: false,
        interactionReady: false,
        mutationPending: false,
        uploadingBrandAsset: null,
      }),
    ).toBe(true);
  });
});
