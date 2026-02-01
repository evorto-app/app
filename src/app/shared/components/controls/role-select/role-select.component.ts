import { COMMA, ENTER } from '@angular/cdk/keycodes';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
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
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faCircleXmark } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { injectQueries } from '@tanstack/angular-query-experimental/inject-queries-experimental';

import { injectTRPC, injectTRPCClient } from '../../../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
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
  readonly separatorKeysCodes: number[] = [ENTER, COMMA];
  readonly value = model<string[]>([]);
  readonly touched = model<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly readonly = input<boolean>(false);
  readonly hidden = input<boolean>(false);

  private trpcClient = injectTRPCClient();
  protected currentRolesQuery = injectQueries(() => ({
    queries: this.value().map((roleId) => ({
      queryFn: () => this.trpcClient.admin.roles.findOne.query({ id: roleId }),
      queryKey: ['roles', roleId],
    })),
  }));
  protected faCircleXmark = faCircleXmark;
  protected readonly searchModel = signal({ query: '' });
  protected readonly searchForm = form(this.searchModel, (schema) => {
    debounce(schema, 300);
    disabled(schema.query, () => this.disabled() || this.readonly());
  });
  protected readonly searchValue = computed(
    () => this.searchForm().value().query,
  );
  private trpc = injectTRPC();
  protected searchRoleQuery = injectQuery(() =>
    this.trpc.admin.roles.search.queryOptions({ search: this.searchValue() }),
  );

  add() {
    if (this.disabled() || this.readonly()) return;
    const currentOptions = this.searchRoleQuery.data();
    if (currentOptions?.length === 1) {
      const next = [
        ...this.value().filter((value) => value !== currentOptions[0].id),
        currentOptions[0].id,
      ];
      this.value.set(next);
      this.touched.set(true);
      this.searchForm.query().value.set('');
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
    event.option.deselect();
  }
}
