import { Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';

@Component({
  imports: [MatButtonModule, RouterLink],
  selector: 'app-template-details',
  styles: ``,
  templateUrl: './template-details.component.html',
})
export class TemplateDetailsComponent {
  protected readonly templateId = input.required<string>();
  private queries = inject(QueriesService);
  protected readonly templateQuery = injectQuery(
    this.queries.template(this.templateId),
  );
}
