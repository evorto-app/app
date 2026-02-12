import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
} from '@angular/core';
import { form, FormField, required, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormField, MatButtonModule, MatInputModule],
  selector: 'app-create-account',
  styles: ``,
  templateUrl: './create-account.component.html',
})
export class CreateAccountComponent {
  private readonly accountModel = signal({
    communicationEmail: '',
    firstName: '',
    lastName: '',
  });
  protected readonly accountForm = form(this.accountModel, (schema) => {
    required(schema.communicationEmail);
    required(schema.firstName);
    required(schema.lastName);
  });
  private readonly rpc = AppRpc.injectClient();
  protected readonly authDataQuery = injectQuery(() =>
    this.rpc.users.authData.queryOptions(),
  );
  private readonly createAccountMutation = injectMutation(() =>
    this.rpc.users.createAccount.mutationOptions(),
  );
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      const authData = this.authDataQuery.data();
      if (!authData) return;
      if (this.accountForm().touched()) return;
      const getString = (value: null | string | undefined) =>
        value?.trim() || undefined;
      this.accountModel.update((current) => ({
        communicationEmail: getString(authData.email) ?? current.communicationEmail,
        firstName: getString(authData.given_name) ?? current.firstName,
        lastName: getString(authData.family_name) ?? current.lastName,
      }));
    });
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    await submit(this.accountForm, async () => {
      const payload = this.accountModel();
      this.createAccountMutation.mutate(payload, {
        onSuccess: async () => {
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['users', 'self']),
          );
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['users', 'maybeSelf']),
          );
          this.router.navigate(['/profile']);
        },
      });
    });
  }
}
