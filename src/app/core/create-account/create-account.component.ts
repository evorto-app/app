import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
} from '@angular/core';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';

import { QueriesService } from '../queries.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, ReactiveFormsModule, MatInputModule],
  selector: 'app-create-account',
  styles: ``,
  templateUrl: './create-account.component.html',
})
export class CreateAccountComponent {
  private formBuilder = inject(NonNullableFormBuilder);
  protected readonly accountForm = this.formBuilder.group({
    communicationEmail: ['', Validators.required],
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
  });
  private readonly queries = inject(QueriesService);
  protected readonly authDataQuery = injectQuery(this.queries.authData());
  private readonly createAccountMutation = injectMutation(
    this.queries.createAccount(),
  );
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      const authData = this.authDataQuery.data();
      if (!authData) return;
      if (this.accountForm.touched) return;
      if (authData.given_name) {
        this.accountForm.patchValue({ firstName: authData.given_name });
      }
      if (authData.family_name) {
        this.accountForm.patchValue({ lastName: authData.family_name });
      }
      if (authData.email) {
        this.accountForm.patchValue({ communicationEmail: authData.email });
      }
    });
  }

  createAccount() {
    if (this.accountForm.invalid) return;
    this.createAccountMutation.mutate(this.accountForm.getRawValue(), {
      onSuccess: () => {
        this.router.navigate(['/profile']);
      },
    });
  }
}
