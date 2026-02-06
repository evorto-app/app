import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  PLATFORM_ID,
  signal,
  viewChild,
} from '@angular/core';
import { FieldTree } from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faEdit } from '@fortawesome/duotone-regular-svg-icons';
import {
  Editor,
} from '@tiptap/core';
import FileHandler from '@tiptap/extension-file-handler';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { TableKit } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { injectMutation } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, FontAwesomeModule],
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

    .editor-content .ProseMirror {
      min-height: 200px;
      outline: none;
    }
  `,
  templateUrl: './editor.component.html',
})
export class EditorComponent {
  readonly control = input<FieldTree<string>>();

  protected readonly faPencil = faEdit;
  protected readonly isMounted = signal(false);
  protected readonly uploadErrorMessage = signal('');
  protected readonly pendingUploads = signal(0);
  protected readonly isUploading = computed(() => this.pendingUploads() > 0);
  private readonly editorStateTick = signal(0);

  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private readonly editorContainer = viewChild<ElementRef<HTMLDivElement>>(
    'editorContainer',
  );
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  private readonly trpc = injectTRPC();
  private readonly createImageUploadMutation = injectMutation(() =>
    this.trpc.editorMedia.createImageDirectUpload.mutationOptions(),
  );

  private editor: Editor | null = null;
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
      editorProps: {
        attributes: {
          class: 'ProseMirror',
          'data-testid': 'rich-editor-content',
          'data-placeholder': 'Start writing...',
        },
      },
      editable: !(field.disabled() || field.readonly()),
      element: container,
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3, 4, 5, 6] },
          strike: true,
        }),
        Link.configure({
          defaultProtocol: 'https',
          openOnClick: false,
        }),
        Image,
        TableKit.configure({
          table: { resizable: true },
        }),
        FileHandler.configure({
          allowedMimeTypes: [
            'image/gif',
            'image/jpeg',
            'image/png',
            'image/webp',
          ],
          onDrop: (editor, files, position) => {
            void this.handleImageFiles(editor, files, position);
          },
          onPaste: (editor, files) => {
            void this.handleImageFiles(editor, files);
          },
        }),
      ],
      onBlur: () => {
        fieldTree().markAsDirty();
      },
      onUpdate: ({ editor: currentEditor }) => {
        this.isSyncingFromEditor = true;
        fieldTree().value.set(currentEditor.getHTML());
        fieldTree().markAsDirty();
        this.isSyncingFromEditor = false;
      },
      onSelectionUpdate: () => {
        this.editorStateTick.update((value) => value + 1);
      },
      onTransaction: () => {
        this.editorStateTick.update((value) => value + 1);
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

  protected readonly hasEditor = computed(() => {
    this.editorStateTick();
    return this.editor !== null;
  });

  protected readonly isReadonly = computed(() => {
    const fieldTree = this.control();
    if (!fieldTree) {
      return false;
    }

    const field = fieldTree();
    return field.disabled() || field.readonly();
  });

  protected activateEditor(): void {
    if (this.isMounted()) {
      this.editor?.commands.focus();
      return;
    }

    this.isMounted.set(true);
  }

  protected openImagePicker(): void {
    if (this.isReadonly()) {
      return;
    }

    this.fileInput()?.nativeElement.click();
  }

  protected onFileInputChange(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    const files = target?.files;

    if (!files || !this.editor) {
      return;
    }

    void this.handleImageFiles(this.editor, Array.from(files));

    if (target) {
      target.value = '';
    }
  }

  protected toggleBold(): void {
    this.editor?.chain().focus().toggleBold().run();
  }

  protected toggleItalic(): void {
    this.editor?.chain().focus().toggleItalic().run();
  }

  protected toggleBulletList(): void {
    this.editor?.chain().focus().toggleBulletList().run();
  }

  protected toggleOrderedList(): void {
    this.editor?.chain().focus().toggleOrderedList().run();
  }

  protected undo(): void {
    this.editor?.chain().focus().undo().run();
  }

  protected redo(): void {
    this.editor?.chain().focus().redo().run();
  }

  protected addLink(): void {
    if (!this.editor) {
      return;
    }

    const previousUrl = this.editor.getAttributes('link')['href'];
    const nextUrl = window.prompt('Enter URL', previousUrl || 'https://');

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

  protected readonly isBoldActive = computed(() => {
    this.editorStateTick();
    return this.editor?.isActive('bold') ?? false;
  });

  protected readonly isItalicActive = computed(() => {
    this.editorStateTick();
    return this.editor?.isActive('italic') ?? false;
  });

  protected readonly isBulletListActive = computed(() => {
    this.editorStateTick();
    return this.editor?.isActive('bulletList') ?? false;
  });

  protected readonly isOrderedListActive = computed(() => {
    this.editorStateTick();
    return this.editor?.isActive('orderedList') ?? false;
  });

  protected readonly isLinkActive = computed(() => {
    this.editorStateTick();
    return this.editor?.isActive('link') ?? false;
  });

  protected readonly canUndo = computed(() => {
    this.editorStateTick();
    return this.editor?.can().chain().focus().undo().run() ?? false;
  });

  protected readonly canRedo = computed(() => {
    this.editorStateTick();
    return this.editor?.can().chain().focus().redo().run() ?? false;
  });

  private async handleImageFiles(
    editor: Editor,
    files: File[],
    position?: number,
  ): Promise<void> {
    if (this.isReadonly()) {
      return;
    }

    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      return;
    }

    this.uploadErrorMessage.set('');

    for (const file of imageFiles) {
      await this.uploadAndInsertImage(editor, file, position);
    }
  }

  private async uploadAndInsertImage(
    editor: Editor,
    file: File,
    position?: number,
  ): Promise<void> {
    const blobUrl = URL.createObjectURL(file);
    this.pendingUploads.update((value) => value + 1);

    try {
      this.insertImageAtPosition(editor, blobUrl, file.name, position);

      const payload = await this.createImageUploadMutation.mutateAsync({
        fileName: file.name,
        fileSizeBytes: file.size,
        mimeType: file.type,
      });

      const uploadBody = new FormData();
      uploadBody.append('file', file);

      const uploadResponse = await fetch(payload.uploadUrl, {
        body: uploadBody,
        method: 'POST',
      });

      if (!uploadResponse.ok) {
        throw new Error(`Image upload failed with status ${uploadResponse.status}`);
      }

      this.replaceImageSource(editor, blobUrl, payload.deliveryUrl);
    } catch (error) {
      this.removeImageBySource(editor, blobUrl);
      this.uploadErrorMessage.set('Image upload failed. Please try again.');
      console.error('Image upload failed', error);
    } finally {
      URL.revokeObjectURL(blobUrl);
      this.pendingUploads.update((value) => Math.max(0, value - 1));
    }
  }

  private insertImageAtPosition(
    editor: Editor,
    src: string,
    alt: string,
    position?: number,
  ): void {
    if (typeof position === 'number') {
      editor
        .chain()
        .focus()
        .setTextSelection(position)
        .setImage({ alt, src })
        .run();
      return;
    }

    editor.chain().focus().setImage({ alt, src }).run();
  }

  private removeImageBySource(editor: Editor, source: string): void {
    const { state } = editor;
    let transaction = state.tr;

    state.doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs['src'] === source) {
        transaction = transaction.delete(pos, pos + node.nodeSize);
      }
    });

    if (transaction.docChanged) {
      editor.view.dispatch(transaction);
    }
  }

  private replaceImageSource(
    editor: Editor,
    fromSource: string,
    toSource: string,
  ): void {
    const { state } = editor;
    let transaction = state.tr;

    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'image' || node.attrs['src'] !== fromSource) {
        return;
      }

      transaction = transaction.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        src: toSource,
      });
    });

    if (transaction.docChanged) {
      editor.view.dispatch(transaction);
    }
  }

  ngOnDestroy(): void {
    this.editor?.destroy();
    this.editor = null;
  }
}
