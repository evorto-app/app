# Migration Map: Signal Forms (Top-Down)

## Order of Migration (Phase 2 → Phase 4)

1. **Top-level feature forms (route entry points)**
   - `src/app/core/create-account/create-account.component.ts`
   - `src/app/admin/general-settings/general-settings.component.ts`
   - `src/app/admin/components/role-form/role-form.component.ts`
   - `src/app/templates/template-create-event/template-create-event.component.ts`
   - `src/app/events/event-edit/event-edit.ts`
   - `src/app/templates/shared/template-form/template-form.component.ts`
   - `src/app/profile/user-profile/user-profile.component.ts`
   - `src/app/events/event-review-dialog/event-review-dialog.component.ts`
   - `src/app/templates/categories/create-edit-category-dialog/create-edit-category-dialog.component.ts`
   - `src/app/events/event-filter-dialog/event-filter-dialog.component.ts`
   - `src/app/events/update-visibility-dialog/update-visibility-dialog.component.ts`

2. **Shared form sections used by multiple screens**
   - `src/app/shared/components/forms/event-general-form/event-general-form.ts`
   - `src/app/shared/components/forms/registration-option-form/registration-option-form.ts`

3. **Standalone controls + dialogs (Phase 3)**
   - `src/app/shared/components/controls/location-selector/location-selector-field/location-selector-field.ts`
   - `src/app/shared/components/controls/location-selector/location-selector-dialog/location-selector-dialog.ts`
   - `src/app/shared/components/controls/icon-selector/icon-selector-field/icon-selector-field.component.ts`
   - `src/app/shared/components/controls/icon-selector/icon-selector-dialog/icon-selector-dialog.component.ts`
   - `src/app/shared/components/controls/editor/editor.component.ts`
   - `src/app/shared/components/controls/role-select/role-select.component.ts`
   - `src/app/shared/components/controls/duration-selector/duration-selector.component.ts`
   - `src/app/shared/directives/noop-value-accessor.directive.ts`
   - `src/app/utils.ts` (`injectNgControl` usage)

4. **Remaining standalone controls used outside forms**
   - `src/app/events/event-list.service.ts` (filter control)

## compatForm Usage Decisions

- **Use compatForm (temporary bridge)**
  - Any form consuming custom controls still using `ControlValueAccessor` or `injectNgControl` until those controls are migrated to Signal Forms.
  - Any `FormArray`-heavy flows where migrating to signal arrays blocks top-level migration (notably event edit/create registrations).

- **Avoid compatForm (migrate directly)**
  - Simple single-field forms (e.g. review dialog, event filter dialog, visibility dialog).
  - Template-driven `ngModel` usage (profile display name) should be replaced with Signal Forms bindings, not bridged.
  - Dialog search controls should move to signal inputs/fields directly.

## High-Risk / Special-Handling Forms

- **Event create/edit flows** (`template-create-event`, `event-edit`)
  - `FormArray` registration options, dynamic patching in effects.
- **Template form** (`template-form.component.ts`)
  - Nested groups, enable/disable + validators based on `isPaid`.
- **Registration option form** (`registration-option-form.ts`)
  - Dynamic validators + enable/disable in `ngOnInit`.
- **Role select + editor + icon selector controls**
  - `injectNgControl` + `NoopValueAccessor` patterns; will require Signal Forms custom control API.
- **Duration selector control**
  - Internal form + CVA conversion to signal forms.
- **Location selector dialog**
  - Async search + autocomplete; ensure signal forms support with debounced search.
