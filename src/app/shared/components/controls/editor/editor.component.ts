import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  model,
} from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { FormValueControl } from '@angular/forms/signals';
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
    ReactiveFormsModule,
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
export class EditorComponent implements FormValueControl<string> {
  readonly value = model<string>('');
  readonly touched = model<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly readonly = input<boolean>(false);
  readonly hidden = input<boolean>(false);

  protected editorControl = new FormControl('', { nonNullable: true });
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

  constructor() {
    effect(() => {
      const nextValue = this.value();
      if (this.editorControl.value !== nextValue) {
        this.editorControl.setValue(nextValue, { emitEvent: false });
      }
    });

    effect(() => {
      if (this.disabled() || this.readonly()) {
        this.editorControl.disable({ emitEvent: false });
      } else {
        this.editorControl.enable({ emitEvent: false });
      }
    });

    this.editorControl.valueChanges.subscribe((value) => {
      this.value.set(value);
      this.touched.set(true);
    });
  }
}
