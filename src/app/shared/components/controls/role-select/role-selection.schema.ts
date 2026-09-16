import { InjectionToken } from '@angular/core';
import { schema, validate, ValidationError } from '@angular/forms/signals';

export interface RoleSelectionValidator {
  validate(
    roleIds: readonly string[],
  ): readonly ValidationError.WithoutFieldTree[];
}

export const ROLE_SELECTION_VALIDATOR =
  new InjectionToken<RoleSelectionValidator>('Role selection validator');

export const roleSelectionSchema = schema<string[]>((roles) => {
  validate(roles, ({ state, value }) =>
    state
      .formFieldBindings()
      .flatMap(
        (binding) =>
          binding.injector
            .get(ROLE_SELECTION_VALIDATOR, null, { self: true })
            ?.validate(value()) ?? [],
      ),
  );
});
