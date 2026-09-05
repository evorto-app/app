import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  effect,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import {
  apply,
  applyEach,
  disabled,
  form,
  FormField,
  maxLength,
  required,
  schema,
  submit,
  validate,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faPlus, faTrashCan } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { consola } from 'consola/browser';

import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '../../../shared/errors/rpc-errors';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { readTenantSettings } from '../settings/settings-form';

interface OnboardingQuestionFormModel {
  optionsText: string;
  prompt: string;
  type: 'selection' | 'shortText';
}

interface OnboardingSettingsFormModel {
  privacyPolicyText: string;
  privacyPolicyUrl: string;
  questions: OnboardingQuestionFormModel[];
}

export const onboardingOptionsFromText = (optionsText: string): string[] => [
  ...new Set(
    optionsText
      .split('\n')
      .map((option) => option.trim())
      .filter(Boolean),
  ),
];

export const onboardingOptionsValidationMessage = (
  optionsText: string,
): string | undefined => {
  const options = onboardingOptionsFromText(optionsText);
  if (options.some((option) => option.length > 80)) {
    return 'Each choice must be 80 characters or fewer.';
  }
  if (options.length < 2 || options.length > 20) {
    return 'Add between 2 and 20 choices.';
  }
  return;
};

const questionSchema = schema<OnboardingQuestionFormModel>((question) => {
  required(question.prompt, { message: 'Enter a question.' });
  maxLength(question.prompt, 200, {
    message: 'Use 200 characters or fewer.',
  });
  validate(question.optionsText, ({ value, valueOf }) => {
    if (valueOf(question.type) === 'shortText') return;
    const message = onboardingOptionsValidationMessage(value());
    return message ? { kind: 'selectionOptions', message } : undefined;
  });
});

const settingsSchema = schema<OnboardingSettingsFormModel>((settings) => {
  applyEach(settings.questions, questionSchema);
  validate(settings.privacyPolicyText, ({ value, valueOf }) =>
    value().trim() || valueOf(settings.privacyPolicyUrl).trim()
      ? undefined
      : {
          kind: 'required',
          message: 'Add privacy policy text or a privacy policy web address.',
        },
  );
});

export const onboardingPublishNotice = (result: {
  affectedUsers: number;
  policyChanged: boolean;
  policyVersion: number;
  questionsChanged: boolean;
}): string => {
  if (result.policyChanged) {
    return `Privacy policy updated. ${result.affectedUsers} members must accept the new policy before continuing.`;
  }
  if (result.questionsChanged) {
    return 'Questions updated. Members who have not answered them will be asked before continuing.';
  }
  return 'No changes to publish';
};

@Injectable({ providedIn: 'root' })
export class OnboardingSettingsOperations {
  private readonly document = inject(DOCUMENT);
  private readonly rpc = AppRpc.injectClient();

  continueOnboarding() {
    this.document.location.assign(
      '/create-account?redirectUrl=%2Fadmin%2Fonboarding',
    );
  }

  publishSettings() {
    return this.rpc.onboarding.publishSettings.mutationOptions();
  }

  settings() {
    return this.rpc.onboarding.adminSettings.queryOptions();
  }

  settingsFilter() {
    return this.rpc.queryFilter(['onboarding', 'adminSettings']);
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  selector: 'app-onboarding-settings',
  templateUrl: './onboarding-settings.component.html',
})
export class OnboardingSettingsComponent {
  protected readonly continuationRequired = signal(false);
  protected readonly faPlus = faPlus;
  protected readonly faTrashCan = faTrashCan;
  protected readonly initialized = signal(false);
  protected readonly publicationFeedback = signal<null | string>(null);
  protected readonly publicationLocked = signal(false);
  private readonly operations = inject(OnboardingSettingsOperations);
  protected readonly publishMutation = injectMutation(() =>
    this.operations.publishSettings(),
  );
  private readonly model = signal<OnboardingSettingsFormModel>({
    privacyPolicyText: '',
    privacyPolicyUrl: '',
    questions: [],
  });
  protected readonly settingsForm = form(this.model, (settings) => {
    apply(settings, settingsSchema);
    disabled(settings, () => this.publicationLocked());
  });
  protected readonly settingsQuery = injectQuery(() =>
    this.operations.settings(),
  );
  private readonly logger = consola.withTag('app/onboarding-settings');
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);

  constructor() {
    effect(() => {
      if (!this.settingsQuery.isSuccess() || this.initialized()) return;
      const settings = this.settingsQuery.data();
      this.model.set({
        privacyPolicyText: settings.policy?.privacyPolicyText ?? '',
        privacyPolicyUrl: settings.policy?.privacyPolicyUrl ?? '',
        questions: settings.questions.map((question) => ({
          optionsText: question.options.join('\n'),
          prompt: question.prompt,
          type: question.type,
        })),
      });
      this.initialized.set(true);
    });
  }

  protected addQuestion(): void {
    if (this.publicationLocked() || this.settingsForm().submitting()) return;
    this.model.update((model) => ({
      ...model,
      questions: [
        ...model.questions,
        { optionsText: '', prompt: '', type: 'shortText' },
      ],
    }));
  }

  protected continuePublishedOnboarding(): void {
    if (!this.continuationRequired()) return;
    try {
      this.operations.continueOnboarding();
    } catch (error) {
      this.publicationFeedback.set(
        'The changes were published, but new member setup could not be opened. Continue to new member setup before making more changes.',
      );
      this.logger.error('Published setup continuation failed', error);
    }
  }

  protected removeQuestion(index: number): void {
    if (this.publicationLocked() || this.settingsForm().submitting()) return;
    this.model.update((model) => ({
      ...model,
      questions: model.questions.filter(
        (_, questionIndex) => questionIndex !== index,
      ),
    }));
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (
      this.publicationLocked() ||
      !this.settingsQuery.isSuccess() ||
      this.settingsForm().invalid() ||
      this.settingsForm().submitting() ||
      this.publishMutation.isPending()
    ) {
      return;
    }

    await submit(this.settingsForm, async (formState) => {
      const value = formState().value();
      this.publicationLocked.set(true);
      this.publicationFeedback.set(null);
      let result: Parameters<typeof onboardingPublishNotice>[0];
      try {
        result = await this.publishMutation.mutateAsync({
          privacyPolicyText: value.privacyPolicyText,
          privacyPolicyUrl: value.privacyPolicyUrl,
          questions: value.questions.map((question) => ({
            options:
              question.type === 'selection'
                ? onboardingOptionsFromText(question.optionsText)
                : [],
            prompt: question.prompt,
            type: question.type,
          })),
        });
      } catch (error) {
        const denial =
          error instanceof RpcUnauthorizedError
            ? 'Sign in again before publishing these settings.'
            : error instanceof RpcForbiddenError
              ? 'Your account does not have access to publish these settings. Ask an administrator to check your access.'
              : getErrorMessage(error, '', [
                  'TenantOnboardingConfigurationError',
                  'TenantOnboardingValidationError',
                ]);
        if (denial) {
          this.publicationLocked.set(false);
          this.notifications.showError(denial);
        } else {
          this.publicationFeedback.set(
            'The publication outcome could not be confirmed. Your entries are still here. Load saved setup to check what was published before trying again. This replaces these entries with the saved values.',
          );
          this.logger.error(
            'Setup publication outcome could not be confirmed',
            error,
          );
        }
        return;
      }

      if (result.policyChanged || result.questionsChanged) {
        this.continuationRequired.set(true);
        this.publicationFeedback.set(
          'The changes were published. Continue to new member setup before making more changes.',
        );
        this.continuePublishedOnboarding();
        return;
      }

      try {
        const read = await readTenantSettings(this.queryClient, [
          this.operations.settingsFilter(),
        ]);
        if (read === 'paused') {
          this.publicationFeedback.set(
            'Evorto confirmed there were no changes to publish, but the saved setup could not be checked while the connection is paused. Your entries are still here. Load saved setup when connected. This replaces these entries with the saved values.',
          );
          return;
        }
      } catch (error) {
        this.publicationFeedback.set(
          'Evorto confirmed there were no changes to publish, but the saved setup could not be loaded. Your entries are still here. Load saved setup before making more changes. This replaces these entries with the saved values.',
        );
        this.logger.error('Confirmed setup could not be loaded', error);
        return;
      }
      this.initialized.set(false);
      this.publicationLocked.set(false);
      this.notifications.showSuccess(onboardingPublishNotice(result));
    });
  }
}
