import { Component, effect, inject, input } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';

@Component({
  imports: [
    MatButtonModule,
    ReactiveFormsModule,
    MatInputModule,
    FontAwesomeModule,
    RouterLink,
  ],
  selector: 'app-template-create-event',
  styles: ``,
  templateUrl: './template-create-event.component.html',
})
export class TemplateCreateEventComponent {
  private fb = inject(NonNullableFormBuilder);
  protected readonly createEventForm = this.fb.group({
    description: this.fb.control('description'),
    icon: this.fb.control('icon'),
    title: this.fb.control(''),
  });
  private queries = inject(QueriesService);
  protected readonly createEventMutation = injectMutation(
    this.queries.createEvent(),
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly templateId = input.required<string>();
  protected readonly templateQuery = injectQuery(
    this.queries.template(this.templateId),
  );
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      const template = this.templateQuery.data();
      if (template) {
        this.createEventForm.patchValue({
          title: template.title,
        });
      }
    });
  }

  async onSubmit() {
    if (this.createEventForm.invalid) {
      return;
    }
    const formValue = this.createEventForm.getRawValue();
    this.createEventMutation.mutate(
      {
        templateId: this.templateId(),
        ...formValue,
      },
      {
        onSuccess: (data) => {
          this.router.navigate(['/events', data.id]);
        },
      },
    );
  }
}
