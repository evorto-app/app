import { Component, effect, inject, input } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
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
    ReactiveFormsModule,
    MatInputModule,
    MatButtonModule,
    MatSelectModule,
    FontAwesomeModule,
    RouterLink,
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
  protected readonly templateCategoriesQuery = injectQuery(
    this.queries.templateCategories(),
  );
  private formBuilder = inject(NonNullableFormBuilder);
  protected templateForm = this.formBuilder.group({
    categoryId: '',
    description: 'description',
    icon: 'icon',
    title: '',
  });
  private router = inject(Router);
  constructor() {
    console.log('TemplateCreateComponent');
    effect(() => {
      const categoryId = this.categoryId();
      if (categoryId) {
        console.log('categoryId', categoryId);
        this.templateForm.patchValue({ categoryId });
      }
    });
  }
  onSubmit() {
    if (this.templateForm.invalid) return;
    this.createTemplateMutation.mutate(this.templateForm.getRawValue(), {
      onSuccess: () => this.router.navigate(['/templates']),
    });
  }
}
