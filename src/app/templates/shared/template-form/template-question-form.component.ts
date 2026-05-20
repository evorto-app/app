import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faTrashCan } from '@fortawesome/duotone-regular-svg-icons';

import { TemplateQuestionFormModel } from './template-question-form.utilities';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  selector: 'app-template-question-form',
  templateUrl: './template-question-form.component.html',
})
export class TemplateQuestionFormComponent {
  public readonly questionForm =
    input.required<FieldTree<TemplateQuestionFormModel>>();
  public readonly remove = output();
  protected readonly faTrashCan = faTrashCan;
}
