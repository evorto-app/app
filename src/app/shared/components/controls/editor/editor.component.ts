import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faEdit } from '@fortawesome/duotone-regular-svg-icons';
import { EditorComponent as TinyEditor } from '@tinymce/tinymce-angular';
import { type RawEditorOptions } from 'tinymce';

import { injectNgControl } from '../../../../utils';
import { NoopValueAccessorDirective } from '../../../directives/noop-value-accessor.directive';

@Component({
  hostDirectives: [NoopValueAccessorDirective],
  imports: [
    ReactiveFormsModule,
    TinyEditor,
    MatButtonModule,
    FontAwesomeModule,
    MatIconModule,
  ],
  selector: 'app-editor',
  styles: `
    :host {
      display: block;
    }
  `,
  templateUrl: './editor.component.html',
})
export class EditorComponent {
  protected config: RawEditorOptions = {
    height: 300,
    menubar: false,
    plugins: 'lists link image table code help wordcount',
    toolbar:
      'undo redo | blocks | bold italic | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | link image',
  };
  protected faPencil = faEdit;
  protected ngControl = injectNgControl();
}
