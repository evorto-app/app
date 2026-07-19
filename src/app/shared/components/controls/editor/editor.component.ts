import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  PLATFORM_ID,
  signal,
  viewChild,
} from '@angular/core';
import { FieldTree } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faEdit } from '@fortawesome/duotone-regular-svg-icons';
import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { TableKit } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatSelectModule,
    FontAwesomeModule,
  ],
  selector: 'app-editor',
  styles: `
    :host {
      display: block;
    }

    .editor-content {
      min-height: 220px;
      outline: none;
      overflow-wrap: anywhere;
      padding: 0.75rem;
    }

    :host ::ng-deep .editor-content .ProseMirror {
      min-height: 200px;
      outline: none;
    }

    :host ::ng-deep .editor-content .ProseMirror-selectednode {
      outline: none;
    }

    :host ::ng-deep .editor-content li.ProseMirror-selectednode::after {
      border-color: transparent;
    }

    :host ::ng-deep .editor-toolbar .mat-mdc-form-field-subscript-wrapper {
      display: none;
    }

    :host ::ng-deep .editor-content .ProseMirror table {
      border-collapse: collapse;
      table-layout: fixed;
      width: 100%;
    }

    :host ::ng-deep .editor-content .ProseMirror th,
    :host ::ng-deep .editor-content .ProseMirror td {
      border: 1px solid var(--mat-sys-outline-variant);
      min-width: 1.5rem;
      padding: 0.375rem 0.5rem;
      position: relative;
      vertical-align: top;
    }

    :host ::ng-deep .editor-content .ProseMirror th {
      background-color: var(--mat-sys-surface-container-low);
      font-weight: 600;
    }

    :host ::ng-deep .editor-content .ProseMirror .selectedCell::after {
      background: color-mix(in srgb, var(--mat-sys-primary) 16%, transparent);
      inset: 0;
      pointer-events: none;
      position: absolute;
    }
  `,
  templateUrl: './editor.component.html',
})
export class EditorComponent implements OnDestroy {
  readonly control = input<FieldTree<string>>();

  private editor: Editor | undefined;

  private readonly editorStateTick = signal(0);
  protected readonly activeTextStyle = computed<
    (typeof this.textStyleOptions)[number]['value']
  >(() => {
    this.editorStateTick();

    if (this.editor?.isActive('heading', { level: 1 })) return 'h1';
    if (this.editor?.isActive('heading', { level: 2 })) return 'h2';
    if (this.editor?.isActive('heading', { level: 3 })) return 'h3';
    if (this.editor?.isActive('heading', { level: 4 })) return 'h4';
    if (this.editor?.isActive('heading', { level: 5 })) return 'h5';
    if (this.editor?.isActive('heading', { level: 6 })) return 'h6';

    return 'paragraph';
  });
  protected readonly canRedo = computed(() => {
    this.editorStateTick();
    return this.editor?.can().chain().focus().redo().run() ?? false;
  });
  protected readonly canUndo = computed(() => {
    this.editorStateTick();
    return this.editor?.can().chain().focus().undo().run() ?? false;
  });
  protected readonly faPencil = faEdit;
  protected readonly hasEditor = computed(() => {
    this.editorStateTick();
    return this.editor !== null;
  });

  protected readonly isBoldActive = computed(() => {
    this.editorStateTick();
    return this.editor?.isActive('bold') ?? false;
  });
  protected readonly isBulletListActive = computed(() => {
    this.editorStateTick();
    return this.editor?.isActive('bulletList') ?? false;
  });

  protected readonly isItalicActive = computed(() => {
    this.editorStateTick();
    return this.editor?.isActive('italic') ?? false;
  });
  protected readonly isLinkActive = computed(() => {
    this.editorStateTick();
    return this.editor?.isActive('link') ?? false;
  });

  protected readonly isMounted = signal(false);
  protected readonly isOrderedListActive = computed(() => {
    this.editorStateTick();
    return this.editor?.isActive('orderedList') ?? false;
  });

  protected readonly isReadonly = computed(() => {
    const fieldTree = this.control();
    if (!fieldTree) {
      return false;
    }

    const field = fieldTree();
    return field.disabled() || field.readonly();
  });
  protected readonly textStyleOptions = [
    { label: 'Paragraph', value: 'paragraph' },
    { label: 'Heading 1', value: 'h1' },
    { label: 'Heading 2', value: 'h2' },
    { label: 'Heading 3', value: 'h3' },
    { label: 'Heading 4', value: 'h4' },
    { label: 'Heading 5', value: 'h5' },
    { label: 'Heading 6', value: 'h6' },
  ] as const;

  private readonly editorContainer =
    viewChild<ElementRef<HTMLDivElement>>('editorContainer');

  private readonly platformId = inject(PLATFORM_ID);

  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private isSyncingFromEditor = false;

  private readonly createEditorFromStateEffect = effect(() => {
    const fieldTree = this.control();
    if (!fieldTree) {
      return;
    }

    const field = fieldTree();
    const container = this.editorContainer()?.nativeElement;

    if (!this.isBrowser || !this.isMounted() || !container || this.editor) {
      return;
    }

    this.editor = new Editor({
      content: field.value() || '<p></p>',
      editable: !(field.disabled() || field.readonly()),
      editorProps: {
        attributes: {
          class:
            'ProseMirror prose prose-sm max-w-none min-h-[200px] outline-none',
          'data-placeholder': 'Start writing...',
          'data-testid': 'rich-editor-content',
        },
      },
      element: container,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5, 6] },
          link: false,
          strike: {},
        }),
        Link.configure({
          defaultProtocol: 'https',
          openOnClick: false,
        }),
        Image,
        TableKit.configure({
          table: { resizable: true },
        }),
      ],
      onBlur: () => {
        fieldTree().markAsDirty();
      },
      onSelectionUpdate: () => {
        this.editorStateTick.update((value) => value + 1);
      },
      onTransaction: () => {
        this.editorStateTick.update((value) => value + 1);
      },
      onUpdate: ({ editor: currentEditor }) => {
        this.isSyncingFromEditor = true;
        fieldTree().value.set(currentEditor.getHTML());
        fieldTree().markAsDirty();
        this.isSyncingFromEditor = false;
      },
    });
  });

  private readonly syncEditorStateEffect = effect(() => {
    const fieldTree = this.control();
    if (!fieldTree) {
      return;
    }

    const field = fieldTree();
    const html = field.value() || '<p></p>';

    if (!this.editor) {
      return;
    }

    this.editor.setEditable(!(field.disabled() || field.readonly()));

    if (this.isSyncingFromEditor) {
      return;
    }

    if (this.editor.getHTML() !== html) {
      this.editor.commands.setContent(html, { emitUpdate: false });
      this.editorStateTick.update((value) => value + 1);
    }
  });

  ngOnDestroy(): void {
    this.editor?.destroy();
    this.editor = undefined;
  }

  protected activateEditor(): void {
    if (this.isMounted()) {
      this.editor?.commands.focus();
      return;
    }

    this.isMounted.set(true);
  }

  protected addLink(): void {
    if (!this.editor) {
      return;
    }

    const previousUrl = this.editor.getAttributes('link')['href'];
    const nextUrl = globalThis.prompt('Enter URL', previousUrl || 'https://');

    if (nextUrl === null) {
      return;
    }

    if (!nextUrl.trim()) {
      this.editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    this.editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: nextUrl.trim() })
      .run();
  }

  protected insertTable(): void {
    this.editor
      ?.chain()
      .focus()
      .insertTable({ cols: 3, rows: 3, withHeaderRow: true })
      .run();
  }

  protected redo(): void {
    this.editor?.chain().focus().redo().run();
  }

  protected setTextStyle(
    textStyle: (typeof this.textStyleOptions)[number]['value'],
  ): void {
    if (!this.editor) {
      return;
    }

    const chain = this.editor.chain().focus();
    switch (textStyle) {
      case 'h1': {
        chain.setHeading({ level: 1 }).run();
        return;
      }
      case 'h2': {
        chain.setHeading({ level: 2 }).run();
        return;
      }
      case 'h3': {
        chain.setHeading({ level: 3 }).run();
        return;
      }
      case 'h4': {
        chain.setHeading({ level: 4 }).run();
        return;
      }
      case 'h5': {
        chain.setHeading({ level: 5 }).run();
        return;
      }
      case 'h6': {
        chain.setHeading({ level: 6 }).run();
        return;
      }
      case 'paragraph': {
        chain.setParagraph().run();
        return;
      }
    }
  }

  protected toggleBold(): void {
    this.editor?.chain().focus().toggleBold().run();
  }

  protected toggleBulletList(): void {
    this.editor?.chain().focus().toggleBulletList().run();
  }

  protected toggleItalic(): void {
    this.editor?.chain().focus().toggleItalic().run();
  }

  protected toggleLink(): void {
    if (!this.editor) {
      return;
    }

    if (this.editor.isActive('link')) {
      this.editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    this.addLink();
  }

  protected toggleOrderedList(): void {
    this.editor?.chain().focus().toggleOrderedList().run();
  }

  protected undo(): void {
    this.editor?.chain().focus().undo().run();
  }
}
