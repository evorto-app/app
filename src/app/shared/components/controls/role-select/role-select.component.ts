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
  maxLength,
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
import { RoleLookupNotFoundError } from '@shared/rpc-contracts/app-rpcs/roles.errors';
import {
  RoleLookupRecord,
  roleSearchMaxLength,
} from '@shared/rpc-contracts/app-rpcs/roles.rpcs';
import { injectQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { injectQueries } from '@tanstack/angular-query-experimental/inject-queries-experimental';
import { Option, Schema } from 'effect';

import { AppRpc } from '../../../../core/effect-rpc-angular-client';
import {
  ROLE_SELECTION_VALIDATOR,
  type RoleSelectionValidator,
} from './role-selection.schema';

interface SelectedRoleView {
  readonly id: string;
  readonly name: string;
  readonly status: 'available' | 'loading' | 'missing' | 'unknown';
}

const roleLookupFreshnessMs = 30_000;
const decodeRoleLookups = Schema.decodeUnknownOption(
  Schema.Array(RoleLookupRecord),
  {
    onExcessProperty: 'error',
  },
);

@Injectable({ providedIn: 'root' })
export class RoleSelectQueries {
  private readonly rpc = AppRpc.injectClient();
  private readonly queryClient = inject(QueryClient);

  search(search: string) {
    return this.rpc.roles.findMany.queryOptions({ search });
  }

  selected(id: string) {
    const cached = this.cachedRole(id);
    return {
      ...this.rpc.roles.findOne.queryOptions({ id }),
      ...(cached && {
        initialData: cached.role,
        initialDataUpdatedAt: cached.updatedAt,
      }),
      retry: false,
      staleTime: roleLookupFreshnessMs,
    };
  }

  private cachedRole(id: string) {
    // This QueryClient belongs to one browser/SSR app. Derive the exact current
    // RPC path so platform-tenant/admin lookups cannot supply these records.
    const [rpcPath] = this.rpc.roles.findMany.queryOptions({}).queryKey;
    const now = Date.now();
    let cached: undefined | { role: RoleLookupRecord; updatedAt: number };
    for (const { state } of this.queryClient.getQueryCache().findAll({
      predicate: (query) => {
        const candidatePath = query.queryKey[0];
        return (
          query.queryKey.length === 2 &&
          Array.isArray(candidatePath) &&
          candidatePath.length === rpcPath.length
        );
      },
      queryKey: [rpcPath],
    })) {
      if (
        state.status !== 'success' ||
        state.fetchStatus !== 'idle' ||
        state.isInvalidated ||
        state.dataUpdatedAt <= 0 ||
        state.dataUpdatedAt > now ||
        now - state.dataUpdatedAt >= roleLookupFreshnessMs ||
        (cached && state.dataUpdatedAt <= cached.updatedAt)
      )
        continue;
      const records = decodeRoleLookups(state.data);
      if (Option.isNone(records)) continue;
      const role = records.value.find((candidate) => candidate.id === id);
      if (role) cached = { role, updatedAt: state.dataUpdatedAt };
    }
    return cached;
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
  providers: [
    { provide: ROLE_SELECTION_VALIDATOR, useExisting: RoleSelectComponent },
  ],
  selector: 'app-role-select',
  styles: ``,
  templateUrl: './role-select.component.html',
})
export class RoleSelectComponent
  implements FormValueControl<string[]>, RoleSelectionValidator
{
  readonly disabled = input<boolean>(false);
  readonly hidden = input<boolean>(false);
  readonly readonly = input<boolean>(false);
  readonly value = model<string[]>([]);
  readonly separatorKeysCodes: number[] = [ENTER, COMMA];
  readonly touched = model<boolean>(false);
  private readonly queries = inject(RoleSelectQueries);
  protected readonly searchModel = signal({ query: '' });
  protected readonly searchForm = form(this.searchModel, (schema) => {
    debounce(schema.query, 300);
    maxLength(schema.query, roleSearchMaxLength);
    disabled(schema.query, () => this.disabled() || this.readonly());
  });
  protected readonly roleSearchMaxLength = roleSearchMaxLength;
  protected readonly searchWithinLimit = computed(
    () => this.searchForm.query().value().length <= roleSearchMaxLength,
  );
  protected readonly rolesQuery = injectQuery(() => ({
    ...this.queries.search(this.searchForm.query().value().trim()),
    enabled: this.searchWithinLimit(),
  }));
  private readonly selectedRoleIds = computed(() => [...new Set(this.value())]);
  private readonly selectedRoleQueries = injectQueries(() => ({
    queries: this.selectedRoleIds().map((id) => this.queries.selected(id)),
  }));
  protected readonly selectedRoles = computed<readonly SelectedRoleView[]>(() =>
    this.selectedRoleIds().map((id, index) => {
      const query = this.selectedRoleQueries()[index];
      // Retained data can name a chip while a mandatory recheck is unfinished.
      const cached = query?.data();
      const name = cached?.id === id ? cached.name : `Role ${id}`;
      if (!query || query.isPending() || query.fetchStatus() !== 'idle') {
        return { id, name, status: 'loading' };
      }
      if (query.isSuccess() && query.data().id === id) {
        return { id, name: query.data().name, status: 'available' };
      }
      const error = query?.error();
      if (Schema.is(RoleLookupNotFoundError)(error) && error.id === id) {
        return { id, name: `Unavailable role (${id})`, status: 'missing' };
      }
      return {
        id,
        name,
        status: query?.isError() ? 'unknown' : 'loading',
      };
    }),
  );
  protected readonly unavailableSelectedRoleCount = computed(
    () =>
      this.selectedRoles().filter((role) => role.status === 'missing').length,
  );
  protected readonly selectedRolesUnverified = computed(() =>
    this.selectedRoles().some((role) => role.status === 'unknown'),
  );
  protected readonly selectedRolesLoading = computed(() =>
    this.selectedRoles().some((role) => role.status === 'loading'),
  );
  protected readonly rolesFetching = computed(
    () =>
      this.rolesQuery.isFetching() ||
      this.selectedRoleQueries().some((query) => query.isFetching()),
  );
  readonly selectionValid = computed(
    () => this.validate(this.value()).length === 0,
  );
  protected readonly availableRoles = computed<readonly RoleLookupRecord[]>(
    () => {
      if (
        this.searchForm.query().controlValue().length > roleSearchMaxLength ||
        this.searchForm.query().controlValue().trim() !==
          this.searchForm.query().value().trim() ||
        !this.rolesQuery.isSuccess()
      )
        return [];
      const selected = new Set(this.value());
      return this.rolesQuery.data().filter((role) => !selected.has(role.id));
    },
  );
  protected faCircleXmark = faCircleXmark;
  protected readonly searchInputHasValue = signal(false);
  protected readonly hasChipGridRole = computed(
    () => this.searchInputHasValue() || this.selectedRoles().length > 0,
  );

  validate(roleIds: readonly string[]) {
    const selected = new Map(
      this.selectedRoles().map((role) => [role.id, role]),
    );
    if (roleIds.some((id) => selected.get(id)?.status === 'missing')) {
      return [
        {
          kind: 'roleMissing',
          message: 'Remove unavailable roles before saving.',
        },
      ];
    }
    return roleIds.some((id) => selected.get(id)?.status !== 'available')
      ? [
          {
            kind: 'roleUnverified',
            message:
              'Wait for selected roles to be verified, or remove them before saving.',
          },
        ]
      : [];
  }

  async retry() {
    await Promise.all([
      ...(this.rolesQuery.isError() ? [this.rolesQuery.refetch()] : []),
      ...this.selectedRoleQueries()
        .filter((query) => query.isError())
        .map((query) => query.refetch()),
    ]);
  }

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
    if (this.disabled() || this.readonly() || !this.rolesQuery.isSuccess())
      return;
    // Material writes the selected ID before emitting this event.
    const role = this.rolesQuery
      .data()
      .find((option) => option.id === event.option.value);
    if (!role) return;
    this.value.set([...this.value().filter((id) => id !== role.id), role.id]);
    this.touched.set(true);
    this.searchForm.query().value.set('');
    this.searchInputHasValue.set(false);
    event.option.deselect();
  }
}
