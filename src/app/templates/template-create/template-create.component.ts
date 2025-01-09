import { Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectMutation } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';
import {
  TemplateFormComponent,
  TemplateFormData,
} from '../shared/template-form/template-form.component';

@Component({
  imports: [
    MatButtonModule,
    FontAwesomeModule,
    RouterLink,
    TemplateFormComponent,
  ],
  selector: 'app-template-create',
  styles: ``,
  templateUrl: './template-create.component.html',
})
export class TemplateCreateComponent {
  protected readonly categoryId = input<string | undefined>();
  private queries = inject(QueriesService);
  protected readonly createTemplateMutation = injectMutation(
    this.queries.createTemplate(),
  );
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly initialFormData = computed(() => ({
    categoryId: this.categoryId() || '',
  }));

  private router = inject(Router);

  onSubmit(formData: TemplateFormData) {
    this.createTemplateMutation.mutate(formData, {
      onSuccess: () => this.router.navigate(['/templates']),
    });
  }
}
