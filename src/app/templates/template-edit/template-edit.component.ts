import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';
import {
  TemplateFormComponent,
  TemplateFormData,
} from '../shared/template-form/template-form.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    FontAwesomeModule,
    RouterLink,
    TemplateFormComponent,
  ],
  selector: 'app-template-edit',
  styles: ``,
  templateUrl: './template-edit.component.html',
})
export class TemplateEditComponent {
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly templateId = input.required<string>();

  private queries = inject(QueriesService);
  protected readonly templateQuery = injectQuery(
    this.queries.template(this.templateId),
  );

  protected readonly updateTemplateMutation = injectMutation(
    this.queries.updateSimpleTemplate(),
  );

  private router = inject(Router);

  onSubmit(formData: TemplateFormData) {
    const id = this.templateId();
    this.updateTemplateMutation.mutate(
      { id, ...formData },
      {
        onSuccess: () => this.router.navigate(['/templates', id]),
      },
    );
  }
}
