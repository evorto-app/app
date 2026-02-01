import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FieldTree, FormField } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faEdit } from '@fortawesome/duotone-regular-svg-icons';
import { WA_WINDOW } from '@ng-web-apis/common';
import {
  EditorComponent as TinyEditor,
  TINYMCE_SCRIPT_SRC,
} from '@tinymce/tinymce-angular';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    TinyEditor,
    MatButtonModule,
    FontAwesomeModule,
    MatIconModule,
  ],
  providers: [
    { provide: TINYMCE_SCRIPT_SRC, useValue: 'tinymce/tinymce.min.js' },
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
  readonly control = input.required<FieldTree<string>>();
  private window = inject(WA_WINDOW);
  private canMatchMedia = typeof this.window.matchMedia === 'function';
  private useDarkMode = this.canMatchMedia
    ? this.window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
  protected config: TinyEditor['init'] = {
    content_css: this.useDarkMode ? 'dark' : 'default',
    height: 600,
    license_key: 'gpl',
    menubar: false,
    plugins: 'lists link image table code help wordcount',
    skin: this.useDarkMode ? 'oxide-dark' : 'oxide',
    toolbar:
      'undo redo | blocks | bold italic | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | link image',
  };
  protected faPencil = faEdit;
}
