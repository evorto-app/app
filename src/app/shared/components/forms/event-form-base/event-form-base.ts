import { inject, Directive } from '@angular/core';
import {
  FormArray,
  NonNullableFormBuilder,
} from '@angular/forms';
import { Router } from '@angular/router';

import { NotificationService } from '../../../../core/notification.service';
import { QueriesService } from '../../../../core/queries.service';
import { RegistrationOptionFormGroup } from '../registration-option-form/registration-option-form';

@Directive()
export abstract class EventFormBase {
  protected fb = inject(NonNullableFormBuilder);
  protected router = inject(Router);
  protected notifications = inject(NotificationService);
  protected queries = inject(QueriesService);

  protected readonly registrationModes = [
    'fcfs',
    'random',
    'application',
  ] as const;

  protected readonly eventForm = this.fb.group({
    description: this.fb.control(''),
    end: this.fb.control<Date>(new Date()),
    icon: this.fb.control(''),
    registrationOptions: this.fb.array<RegistrationOptionFormGroup>([]),
    start: this.fb.control<Date>(new Date()),
    title: this.fb.control(''),
  });

  get registrationOptions() {
    return this.eventForm.get(
      'registrationOptions',
    ) as (typeof this.eventForm)['controls']['registrationOptions'];
  }

  protected populateRegistrationOptions(registrationOptions: any[]) {
    const registrationOptionsFormArray = this.eventForm.get(
      'registrationOptions',
    ) as FormArray;
    registrationOptionsFormArray.clear();
    
    for (const option of registrationOptions) {
      registrationOptionsFormArray?.push(
        this.fb.group({
          closeRegistrationTime: [option.closeRegistrationTime ? new Date(option.closeRegistrationTime) : null],
          description: [option.description],
          isPaid: [option.isPaid],
          openRegistrationTime: [option.openRegistrationTime ? new Date(option.openRegistrationTime) : null],
          organizingRegistration: [option.organizingRegistration],
          price: [option.price],
          registeredDescription: [option.registeredDescription],
          registrationMode: [option.registrationMode],
          spots: [option.spots],
          title: [option.title],
        }),
      );
    }
  }

  protected transformRegistrationOptions(registrationOptions: any[]) {
    return registrationOptions?.map(option => ({
      closeRegistrationTime: option.closeRegistrationTime!,
      description: option.description || null,
      isPaid: option.isPaid!,
      openRegistrationTime: option.openRegistrationTime!,
      organizingRegistration: option.organizingRegistration!,
      price: option.price!,
      registeredDescription: option.registeredDescription || null,
      registrationMode: option.registrationMode! as 'fcfs' | 'random' | 'application',
      spots: option.spots!,
      title: option.title!,
    })) || [];
  }

  protected handleFormErrors() {
    if (this.eventForm.invalid) {
      this.notifications.showError('Please fill in all required fields');
      return false;
    }
    return true;
  }

  protected abstract onSubmit(): void;
}