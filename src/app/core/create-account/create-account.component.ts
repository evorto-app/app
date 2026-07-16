import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import {
  applyEach,
  form,
  FormField,
  maxLength,
  pattern,
  required,
  schema,
  submit,
  validate,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { notificationEmailPattern } from '@shared/notification-email';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import {
  createAccountErrorMessage,
  createAccountModelFromAuthData,
  createAccountModelFromRequirements,
  createAccountPayloadFromModel,
  createAccountSubmitDisabled,
  isAuthEmailVerifiedForAccountCreation,
  isTenantOnboardingRequirementsChangedError,
  mergeCreateAccountModelWithChangedRequirements,
} from './create-account.helpers';

const onboardingAnswerSchema = schema<{ questionId: string; value: string }>(
  (answer) => {
    required(answer.questionId);
    required(answer.value, { message: 'Answer this required question.' });
    maxLength(answer.value, 250, {
      message: 'Use 250 characters or fewer.',
    });
  },
);

@Injectable({ providedIn: 'root' })
export class CreateAccountOperations {
  private readonly rpc = AppRpc.injectClient();

  authData() {
    return this.rpc.users.authData.queryOptions();
  }

  completeOnboarding() {
    return this.rpc.onboarding.complete.mutationOptions();
  }

  maybeSelfFilter() {
    return this.rpc.queryFilter(['users', 'maybeSelf']);
  }

  onboardingRequirements() {
    return this.rpc.onboarding.requirements.queryOptions();
  }

  onboardingStatusFilter() {
    return this.rpc.queryFilter(['onboarding', 'status']);
  }

  selfFilter() {
    return this.rpc.queryFilter(['users', 'self']);
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  selector: 'app-create-account',
  styles: ``,
  templateUrl: './create-account.component.html',
})
export class CreateAccountComponent {
  protected readonly accountError = signal('');
  private readonly accountModel = signal({
    acceptedPrivacyPolicy: false,
    answers: [] as { questionId: string; value: string }[],
    communicationEmail: '',
    firstName: '',
    lastName: '',
    policyVersionId: '',
  });
  protected readonly accountForm = form(this.accountModel, (formPath) => {
    validate(formPath.acceptedPrivacyPolicy, ({ value }) =>
      value()
        ? undefined
        : {
            kind: 'required',
            message: 'Accept the current privacy policy.',
          },
    );
    applyEach(formPath.answers, onboardingAnswerSchema);
    required(formPath.communicationEmail, {
      message: 'Enter the email address where you receive notifications.',
    });
    pattern(formPath.communicationEmail, notificationEmailPattern, {
      message: 'Enter a valid email address.',
    });
    required(formPath.firstName);
    required(formPath.lastName);
    required(formPath.policyVersionId);
  });
  private readonly operations = inject(CreateAccountOperations);
  protected readonly authDataQuery = injectQuery(() =>
    this.operations.authData(),
  );
  protected readonly completeOnboardingMutation = injectMutation(() =>
    this.operations.completeOnboarding(),
  );
  protected readonly createAccountSubmitDisabled = createAccountSubmitDisabled;
  protected readonly isAuthEmailVerifiedForAccountCreation =
    isAuthEmailVerifiedForAccountCreation;
  protected readonly onboardingRequirementsQuery = injectQuery(() =>
    this.operations.onboardingRequirements(),
  );
  private readonly queryClient = inject(QueryClient);
  private requirementsInitialized = false;
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      const authData = this.authDataQuery.data();
      if (!authData || this.accountForm().touched()) return;
      this.accountModel.update((current) =>
        createAccountModelFromAuthData(current, authData),
      );
    });
    effect(() => {
      if (!this.onboardingRequirementsQuery.isSuccess()) return;
      const requirements = this.onboardingRequirementsQuery.data();
      if (requirements.complete) {
        this.router.navigate(['/profile']);
        return;
      }
      this.accountModel.update((current) =>
        this.requirementsInitialized
          ? mergeCreateAccountModelWithChangedRequirements(
              current,
              requirements,
            )
          : createAccountModelFromRequirements(current, requirements),
      );
      this.requirementsInitialized = true;
    });
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    if (
      createAccountSubmitDisabled({
        formInvalid: this.accountForm().invalid(),
        formSubmitting: this.accountForm().submitting(),
        mutationPending: this.completeOnboardingMutation.isPending(),
      })
    ) {
      return;
    }

    await submit(this.accountForm, async () => {
      const payload = createAccountPayloadFromModel(this.accountModel());
      this.accountError.set('');
      try {
        await this.completeOnboardingMutation.mutateAsync(payload);
        await this.queryClient.invalidateQueries(
          this.operations.onboardingStatusFilter(),
        );
        await this.queryClient.invalidateQueries(this.operations.selfFilter());
        await this.queryClient.invalidateQueries(
          this.operations.maybeSelfFilter(),
        );
        this.router.navigate(['/profile']);
      } catch (error) {
        this.accountError.set(createAccountErrorMessage(error));
        if (isTenantOnboardingRequirementsChangedError(error)) {
          await this.onboardingRequirementsQuery.refetch();
        }
      }
    });
  }
}
