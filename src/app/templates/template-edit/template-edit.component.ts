import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectMutation, injectQuery, QueryClient } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';
import {
  TemplateFormComponent,
  TemplateFormData,
} from '../shared/template-form/template-form.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, FontAwesomeModule, RouterLink, TemplateFormComponent],
  selector: 'app-template-edit',
  styles: ``,
  templateUrl: './template-edit.component.html',
})
export class TemplateEditComponent {
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly templateId = input.required<string>();

  private trpc = injectTRPC();
  protected readonly templateQuery = injectQuery(() =>
    this.trpc.templates.findOne.queryOptions({ id: this.templateId() }),
  );

  protected readonly simpleTemplateData = computed(() => {
    const templateData = this.templateQuery.data();
    if (!templateData) return templateData;
    const organizerRegistration =
      templateData.registrationOptions.find((option) => option.organizingRegistration) ?? {};
    const participantRegistration =
      templateData.registrationOptions.find((option) => !option.organizingRegistration) ?? {};
    return {
      ...templateData,
      organizerRegistration,
      participantRegistration,
    };
  });

  protected readonly updateTemplateMutation = injectMutation(() =>
    this.trpc.templates.updateSimpleTemplate.mutationOptions(),
  );

  private queryClient = inject(QueryClient);
  private router = inject(Router);

  onSubmit(formData: TemplateFormData) {
    const id = this.templateId();
    this.updateTemplateMutation.mutate(
      { id, ...formData },
      {
        onSuccess: async () => {
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.templates.findOne.queryKey({ id }),
          });
          await this.queryClient.invalidateQueries({
            queryKey: this.trpc.templates.groupedByCategory.pathKey(),
          });
          this.router.navigate(['/templates', id]);
        },
      },
    );
  }
}
