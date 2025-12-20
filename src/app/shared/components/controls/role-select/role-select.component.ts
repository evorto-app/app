import { COMMA, ENTER } from '@angular/cdk/keycodes';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
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
import { startWith, Subscription } from 'rxjs';

import { injectTRPC } from '../../../../core/trpc-client';
import { injectNgControl } from '../../../../utils';
import { NoopValueAccessorDirective } from '../../../directives/noop-value-accessor.directive';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [NoopValueAccessorDirective],
  imports: [
    FontAwesomeModule,
    MatFormFieldModule,
    MatAutocompleteModule,
    MatChipsModule,
    ReactiveFormsModule,
  ],
  selector: 'app-role-select',
  styles: ``,
  templateUrl: './role-select.component.html',
})
export class RoleSelectComponent implements AfterViewInit, OnDestroy {
  readonly separatorKeysCodes: number[] = [ENTER, COMMA];
  private currentValue = signal<string[]>([]);
  private trpc = injectTRPC();
  protected currentRoles = injectQueries(() => ({
    combine: (results) => results.map((queryResult) => queryResult.data()),
    queries: this.currentValue().map((roleId: string) =>
      this.trpc.admin.roles.findOne.queryOptions({ id: roleId }),
    ),
  }));
  protected faCircleXmark = faCircleXmark;
  protected ngControl = injectNgControl();
  protected searchInput = new FormControl('', { nonNullable: true });
  protected searchValue = toSignal(this.searchInput.valueChanges, {
    initialValue: '',
  });
  protected searchRoleQuery = injectQuery(() =>
    this.trpc.admin.roles.search.queryOptions({ search: this.searchValue() }),
  );
  private signalSubscription: Subscription | undefined;

  add() {
    const currentOptions = this.searchRoleQuery.data();
    if (currentOptions?.length === 1) {
      this.ngControl.control.patchValue([
        ...this.ngControl.value.filter((value: string) => value !== currentOptions[0].id),
        currentOptions[0].id,
      ]);
      this.searchInput.setValue('');
    }
  }

  ngAfterViewInit(): void {
    this.signalSubscription = this.ngControl.valueChanges
      ?.pipe(startWith(this.ngControl.value))
      .subscribe((roleIds) => {
        this.currentValue.set(roleIds ?? []);
      });
  }

  ngOnDestroy(): void {
    this.signalSubscription?.unsubscribe();
  }

  remove(id?: string) {
    if (id) {
      this.ngControl.control.patchValue(
        this.ngControl.value.filter((roleId: string) => roleId !== id),
      );
    }
  }

  selected(event: MatAutocompleteSelectedEvent) {
    this.ngControl.control.patchValue([
      ...this.ngControl.value.filter((roleId: string) => roleId !== event.option.value),
      event.option.value,
    ]);
    this.searchInput.setValue('');
    event.option.deselect();
  }
}
