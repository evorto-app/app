import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormField, form, required, submit } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { Router } from '@angular/router';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { injectTRPC, injectTRPCClient } from '../../core/trpc-client';

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
  // Integration can't be used due to some type weirdness
  private trpcClient = injectTRPCClient();
  protected readonly authDataQuery = injectQuery(() => ({
    queryFn: () => this.trpcClient.users.authData.query(),
    queryKey: ['authData'],
  }));

  private readonly trpc = injectTRPC();
  private readonly createAccountMutation = injectMutation(() =>
    this.trpc.users.createAccount.mutationOptions(),
  );
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  constructor() {
    // this.trpcClient.users.authData.query().then(consola.info);
    effect(() => {
      const authData = this.authDataQuery.data();
      if (!authData) return;
      if (this.accountForm().touched()) return;
      this.accountModel.update((current) => ({
        communicationEmail: authData.email ?? current.communicationEmail,
        firstName: authData.given_name ?? current.firstName,
        lastName: authData.family_name ?? current.lastName,
      }));
    });
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    await submit(this.accountForm, async () => {
      const payload = this.accountModel();
      this.createAccountMutation.mutate(payload, {
        onSuccess: async () => {
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.users.self.pathKey(),
          });
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.users.maybeSelf.pathKey(),
          });
          this.router.navigate(['/profile']);
        },
      });
    });
  }
}
