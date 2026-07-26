import type { RoleLookupRecord } from '@shared/rpc-contracts/app-rpcs/roles.rpcs';

import { COMMA, ENTER } from '@angular/cdk/keycodes';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injectable,
  input,
  model,
  signal,
} from '@angular/core';
import {
  debounce,
  disabled,
  form,
  FormField,
  FormValueControl,
} from '@angular/forms/signals';
import {
  MatAutocompleteModule,
  MatAutocompleteSelectedEvent,
} from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faCircleXmark } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../../../core/effect-rpc-angular-client';

interface SelectedRoleView {
  readonly id: string;
  readonly name: string;
  readonly unavailable: boolean;
}

@Injectable({ providedIn: 'root' })
export class RoleSelectQueries {
  private readonly rpc = AppRpc.injectClient();

  catalog() {
    return this.rpc.roles.findMany.queryOptions({});
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    MatButtonModule,
    MatFormFieldModule,
    MatAutocompleteModule,
    MatChipsModule,
    FormField,
  ],
  selector: 'app-role-select',
  styles: ``,
  templateUrl: './role-select.component.html',
})
export class RoleSelectComponent implements FormValueControl<string[]> {
  readonly disabled = input<boolean>(false);
  readonly hidden = input<boolean>(false);
  readonly readonly = input<boolean>(false);
  readonly separatorKeysCodes: number[] = [ENTER, COMMA];
  readonly touched = model<boolean>(false);
  readonly value = model<string[]>([]);

  private readonly queries = inject(RoleSelectQueries);
  protected readonly rolesQuery = injectQuery(() => this.queries.catalog());
  protected readonly searchModel = signal({ query: '' });
  protected readonly searchForm = form(this.searchModel, (schema) => {
    debounce(schema, 300);
    disabled(
      schema.query,
      () => this.disabled() || this.readonly() || !this.rolesQuery.isSuccess(),
    );
  });
  protected readonly searchValue = computed(
    () => this.searchForm().value().query,
  );
  protected readonly availableRoles = computed<readonly RoleLookupRecord[]>(
    () => {
      if (!this.rolesQuery.isSuccess()) return [];
      const selected = new Set(this.value());
      const search = this.searchValue().trim().toLowerCase();
      return this.rolesQuery
        .data()
        .filter(
          (role) =>
            !selected.has(role.id) &&
            (search.length === 0 || role.name.toLowerCase().includes(search)),
        );
    },
  );
  protected faCircleXmark = faCircleXmark;
  protected readonly searchInputHasValue = signal(false);
  protected readonly selectedRoles = computed<readonly SelectedRoleView[]>(
    () => {
      if (!this.rolesQuery.isSuccess()) return [];
      const catalog = new Map(
        this.rolesQuery.data().map((role) => [role.id, role]),
      );
      return this.value().map((roleId) => {
        const role = catalog.get(roleId);
        return role
          ? { id: role.id, name: role.name, unavailable: false }
          : { id: roleId, name: 'Unavailable role', unavailable: true };
      });
    },
  );
  protected readonly hasChipGridRole = computed(
    () => this.searchInputHasValue() || this.selectedRoles().length > 0,
  );
  protected readonly unavailableSelectedRoleCount = computed(
    () => this.selectedRoles().filter((role) => role.unavailable).length,
  );

  add() {
    if (this.disabled() || this.readonly()) return;
    const currentOptions = this.availableRoles();
    if (currentOptions?.length === 1) {
      const next = [
        ...this.value().filter((value) => value !== currentOptions[0].id),
        currentOptions[0].id,
      ];
      this.value.set(next);
      this.touched.set(true);
      this.searchForm.query().value.set('');
      this.searchInputHasValue.set(false);
    }
  }

  remove(id?: string) {
    if (this.disabled() || this.readonly()) return;
    if (id) {
      this.value.set(this.value().filter((roleId) => roleId !== id));
      this.touched.set(true);
    }
  }

  selected(event: MatAutocompleteSelectedEvent) {
    if (this.disabled() || this.readonly()) return;
    this.value.set([
      ...this.value().filter((roleId) => roleId !== event.option.value),
      event.option.value,
    ]);
    this.touched.set(true);
    this.searchForm.query().value.set('');
    this.searchInputHasValue.set(false);
    event.option.deselect();
  }
}
