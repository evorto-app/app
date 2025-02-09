import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
import { PartialDeep } from 'type-fest';

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
  selector: 'app-template-create',
  styles: ``,
  templateUrl: './template-create.component.html',
})
export class TemplateCreateComponent {
  protected readonly categoryId = input<string | undefined>();
  private queries = inject(QueriesService);
  protected readonly createTemplateMutation = injectMutation(
    this.queries.createSimpleTemplate(),
  );
  protected readonly faArrowLeft = faArrowLeft;
  private defaultOrganizerRolesQuery = injectQuery(
    this.queries.defaultOrganizerRoles(),
  );
  private defaultUserRolesQuery = injectQuery(this.queries.defaultUserRoles());
  protected readonly initialFormData = computed<PartialDeep<TemplateFormData>>(
    () => {
      return {
        categoryId: this.categoryId() || '',
        organizerRegistration: {
          roleIds:
            this.defaultOrganizerRolesQuery.data()?.map((role) => role.id) ||
            [],
        },
        participantRegistration: {
          roleIds:
            this.defaultUserRolesQuery.data()?.map((role) => role.id) || [],
        },
      };
    },
  );

  private router = inject(Router);

  onSubmit(formData: TemplateFormData) {
    this.createTemplateMutation.mutate(formData, {
      onSuccess: () => this.router.navigate(['/templates']),
    });
  }
}
