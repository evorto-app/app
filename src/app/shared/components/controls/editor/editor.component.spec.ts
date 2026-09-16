import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EditorComponent } from './editor.component';

describe('EditorComponent saved content', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EditorComponent],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('preserves a saved image when surrounding text is edited and formatted', async () => {
    const imageSource = 'https://images.example.invalid/existing.png';
    const model = signal({
      content: `<p>Original description</p><img src="${imageSource}" alt="Existing illustration" title="Existing title">`,
    });
    const fields = TestBed.runInInjectionContext(() => form(model));
    const fixture = TestBed.createComponent(EditorComponent);
    fixture.componentRef.setInput('control', fields.content);
    await fixture.whenStable();

    const root: unknown = fixture.nativeElement;
    if (!(root instanceof HTMLElement)) {
      throw new TypeError('Expected the editor component element');
    }
    const placeholder = root.querySelector<HTMLElement>(
      '[data-testid="rich-editor-placeholder"]',
    );
    if (!placeholder)
      throw new Error('Expected the saved-content editor entry');
    placeholder.click();
    await fixture.whenStable();

    const content = root.querySelector<HTMLElement>(
      '[data-testid="rich-editor-content"]',
    );
    if (
      !content ||
      !('editor' in content) ||
      !(content.editor instanceof Editor)
    ) {
      throw new Error('Expected the mounted Tiptap editor');
    }
    content.editor.commands.insertContentAt(1, 'Updated ');
    content.editor.commands.setTextSelection(1);
    expect(content.editor.commands.toggleBulletList()).toBe(true);
    await fixture.whenStable();

    const serialized = new DOMParser().parseFromString(
      model().content,
      'text/html',
    );
    expect(serialized.body.textContent).toContain(
      'Updated Original description',
    );
    expect(
      serialized.body.querySelector(':scope > ul > li')?.textContent,
    ).toContain('Updated Original description');
    expect(serialized.querySelectorAll('img')).toHaveLength(1);
    const savedImage = serialized.querySelector('img');
    expect(savedImage?.getAttribute('src')).toBe(imageSource);
    expect(savedImage?.getAttribute('alt')).toBe('Existing illustration');
    expect(savedImage?.getAttribute('title')).toBe('Existing title');
  });
});
