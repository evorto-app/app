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

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';

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

const questionSchema = schema<OnboardingQuestionFormModel>((question) => {
  required(question.prompt);
  maxLength(question.prompt, 200);
  validate(question.optionsText, ({ value, valueOf }) => {
    if (valueOf(question.type) === 'shortText') return;
    const options = value()
      .split('\n')
      .map((option) => option.trim())
      .filter(Boolean);
    return new Set(options).size >= 2
      ? undefined
      : {
          kind: 'minOptions',
          message: 'Selection questions need at least two different options.',
        };
  });
});

const settingsSchema = schema<OnboardingSettingsFormModel>((settings) => {
  applyEach(settings.questions, questionSchema);
  validate(settings.privacyPolicyText, ({ value, valueOf }) =>
    value().trim() || valueOf(settings.privacyPolicyUrl).trim()
      ? undefined
      : {
          kind: 'required',
          message: 'Add privacy policy text or a privacy policy URL.',
        },
  );
});

export const onboardingOptionsFromText = (optionsText: string): string[] => [
  ...new Set(
    optionsText
      .split('\n')
      .map((option) => option.trim())
      .filter(Boolean),
  ),
];

export const onboardingPublishNotice = (result: {
  affectedUsers: number;
  policyChanged: boolean;
  policyVersion: number;
  questionsChanged: boolean;
}): string => {
  if (result.policyChanged) {
    return `Privacy policy version ${result.policyVersion} published. ${result.affectedUsers} tenant users must accept it before continuing.`;
  }
  if (result.questionsChanged) {
    return 'Onboarding questions updated. Tenant users with missing answers will be prompted before continuing.';
  }
  return 'Onboarding settings are unchanged';
};

@Injectable({ providedIn: 'root' })
export class OnboardingSettingsOperations {
  private readonly rpc = AppRpc.injectClient();

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
  protected readonly faPlus = faPlus;
  protected readonly faTrashCan = faTrashCan;
  private readonly operations = inject(OnboardingSettingsOperations);
  protected readonly publishMutation = injectMutation(() =>
    this.operations.publishSettings(),
  );
  private readonly model = signal<OnboardingSettingsFormModel>({
    privacyPolicyText: '',
    privacyPolicyUrl: '',
    questions: [],
  });
  protected readonly settingsForm = form(this.model, settingsSchema);
  protected readonly settingsQuery = injectQuery(() =>
    this.operations.settings(),
  );
  private readonly initialized = signal(false);
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
    this.model.update((model) => ({
      ...model,
      questions: [
        ...model.questions,
        { optionsText: '', prompt: '', type: 'shortText' },
      ],
    }));
  }

  protected removeQuestion(index: number): void {
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
      this.settingsForm().invalid() ||
      this.settingsForm().submitting() ||
      this.publishMutation.isPending()
    ) {
      return;
    }

    await submit(this.settingsForm, async (formState) => {
      const value = formState().value();
      try {
        const result = await this.publishMutation.mutateAsync({
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
        await this.queryClient.invalidateQueries(
          this.operations.settingsFilter(),
        );
        this.initialized.set(false);
        this.notifications.showSuccess(onboardingPublishNotice(result));
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to publish onboarding settings'),
        );
      }
    });
  }
}
