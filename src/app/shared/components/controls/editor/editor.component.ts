import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { EditorComponent as TinyEditor } from '@tinymce/tinymce-angular';
import { type RawEditorOptions } from 'tinymce';

import { injectNgControl } from '../../../../utils';
import { NoopValueAccessorDirective } from '../../../directives/noop-value-accessor.directive';
@Component({
  hostDirectives: [NoopValueAccessorDirective],
  imports: [ReactiveFormsModule, TinyEditor],
  selector: 'app-editor',
  styles: ``,
  templateUrl: './editor.component.html',
})
export class EditorComponent {
  protected config: RawEditorOptions = {
    plugins: 'lists link image table code help wordcount',
  };
  protected ngControl = injectNgControl();
}
