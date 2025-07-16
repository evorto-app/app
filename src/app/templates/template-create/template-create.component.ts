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

import { injectTRPC } from '../../core/trpc-client';
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
  private trpc = injectTRPC();
  protected readonly createTemplateMutation = injectMutation(
    this.trpc.templates.createSimpleTemplate.mutationOptions(),
  );
  protected readonly faArrowLeft = faArrowLeft;
  private defaultOrganizerRolesQuery = injectQuery(
    this.trpc.admin.roles.findMany.queryOptions({ defaultOrganizerRole: true }),
  );
  private defaultUserRolesQuery = injectQuery(this.trpc.admin.roles.findMany.queryOptions({ defaultUserRole: true }));
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
