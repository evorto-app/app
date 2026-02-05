# Signal Forms Migration Inventory

## Reactive Forms (Groups/Arrays)

- `src/app/core/create-account/create-account.component.ts`:
  - `accountForm` (group: `firstName`, `lastName`, `communicationEmail`), `Validators.required`.
- `src/app/admin/general-settings/general-settings.component.ts`:
  - `settingsForm` (group: `defaultLocation`, `theme`), uses `app-location-selector-field`.
- `src/app/admin/components/role-form/role-form.component.ts`:
  - `permissionForm` (group with nested `permissions` group), valueChanges -> computed group states.
- `src/app/shared/components/forms/event-general-form/event-general-form.ts`:
  - `EventGeneralFormGroup` typed `FormGroup`, includes `registrationOptions: FormArray`.
- `src/app/shared/components/forms/registration-option-form/registration-option-form.ts`:
  - `RegistrationOptionFormGroup` typed `FormGroup`, toggles `stripeTaxRateId` enable/disable and adds `Validators.required`.
- `src/app/shared/components/controls/duration-selector/duration-selector.component.ts`:
  - `durationForm` (group: `days`, `hours`) inside a CVA.
- `src/app/templates/shared/template-form/template-form.component.ts`:
  - `templateForm` (group with nested `organizerRegistration` + `participantRegistration`), adds `Validators.required` to tax rate controls and toggles enable/disable via effects.
- `src/app/templates/categories/create-edit-category-dialog/create-edit-category-dialog.component.ts`:
  - `categoryForm` (group: `icon`, `title`), `Validators.required` for title; disables icon on edit.
- `src/app/templates/template-create-event/template-create-event.component.ts`:
  - `createEventForm` with `registrationOptions: FormArray<RegistrationOptionFormGroup>`.
- `src/app/events/event-filter-dialog/event-filter-dialog.component.ts`:
  - `filterForm` (group: `includeUnlisted`, `statusFilter`).
- `src/app/events/event-edit/event-edit.ts`:
  - `editEventForm` with `registrationOptions: FormArray<RegistrationOptionFormGroup>`.
- `src/app/events/event-review-dialog/event-review-dialog.component.ts`:
  - `reviewForm` (group: `comment`), `Validators.required`.

## Reactive Forms (Standalone Controls)

- `src/app/shared/components/controls/location-selector/location-selector-dialog/location-selector-dialog.ts`:
  - `locationControl` for search with debounced async lookup.
- `src/app/shared/components/controls/icon-selector/icon-selector-dialog/icon-selector-dialog.component.ts`:
  - `searchControl` with debounced valueChanges.
- `src/app/shared/components/controls/role-select/role-select.component.ts`:
  - `searchInput` control for role search.
- `src/app/events/update-visibility-dialog/update-visibility-dialog.component.ts`:
  - `unlistedControl` for event visibility toggle.
- `src/app/profile/user-profile/user-profile.component.ts`:
  - `esnCardControl` with `Validators.pattern`.
- `src/app/events/event-list.service.ts`:
  - `statusFilterControl` for event list filtering.

## Template-Driven Usage

- `src/app/profile/user-profile/user-profile.component.html`:
  - `[ngModel]`/`(ngModelChange)` for `displayName`.

## Custom Controls / CVA / Value Accessors

- `src/app/shared/directives/noop-value-accessor.directive.ts`:
  - `NoopValueAccessorDirective` (CVA) used to integrate controls via `NgControl`.
- `src/app/shared/components/controls/location-selector/location-selector-field/location-selector-field.ts`:
  - `LocationSelectorField` (CVA + `NG_VALUE_ACCESSOR`).
- `src/app/shared/components/controls/duration-selector/duration-selector.component.ts`:
  - `DurationSelectorComponent` (CVA + internal `FormGroup`).
- `src/app/shared/components/controls/icon-selector/icon-selector-field/icon-selector-field.component.ts`:
  - `IconSelectorFieldComponent` uses `NoopValueAccessorDirective` + `injectNgControl()`.
- `src/app/shared/components/controls/editor/editor.component.ts`:
  - `EditorComponent` uses `NoopValueAccessorDirective` + `injectNgControl()`.
- `src/app/shared/components/controls/role-select/role-select.component.ts`:
  - `RoleSelectComponent` uses `NoopValueAccessorDirective` + `injectNgControl()`.
- `src/app/utils.ts`:
  - `injectNgControl()` relies on `NgControl` + `FormControlName`/`FormControlDirective`/`NgModel`.

## Notes for Migration Order

- Shared form components (`event-general-form`, `registration-option-form`) are used by event edit/create flows.
- CVA-based controls and `NoopValueAccessorDirective` need alignment with Signal Forms custom control APIs.
- `FormArray` usage in event edit/template create flows requires signal-form array equivalents.
- `ngModel` usage in profile edit view needs migration to Signal Forms bindings.
