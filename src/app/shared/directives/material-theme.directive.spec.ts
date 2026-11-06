import { OverlayContainer } from '@angular/cdk/overlay';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { MaterialThemeDirective } from './material-theme.directive';

@Component({
  imports: [MaterialThemeDirective],
  template: '<section appMaterialTheme [baseColor]="color()"></section>',
})
class ThemedPage {
  readonly color = signal<number | undefined>(0xff_00_85_77);
}

describe('Material page overlay theme', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('follows page color changes and restores existing overlay styles when the page leaves', async () => {
    const overlayStyle =
      TestBed.inject(OverlayContainer).getContainerElement().style;
    overlayStyle.setProperty(
      '--mat-sys-primary',
      'original-primary',
      'important',
    );
    overlayStyle.setProperty('--unrelated-overlay-setting', 'preserved');
    const fixture = TestBed.createComponent(ThemedPage);
    await fixture.whenStable();
    const page: unknown = fixture.nativeElement;
    if (!(page instanceof HTMLElement))
      throw new TypeError('Expected page element');
    const themedPage = page.querySelector('section');
    if (!themedPage) throw new Error('Expected themed page');
    const firstPrimary = overlayStyle.getPropertyValue('--mat-sys-primary');
    expect(firstPrimary).toBe(
      themedPage.style.getPropertyValue('--mat-sys-primary'),
    );
    expect(firstPrimary).not.toBe('original-primary');

    fixture.componentInstance.color.set(0xff_bb_22_00);
    await fixture.whenStable();
    expect(overlayStyle.getPropertyValue('--mat-sys-primary')).toBe(
      themedPage.style.getPropertyValue('--mat-sys-primary'),
    );
    expect(overlayStyle.getPropertyValue('--mat-sys-primary')).not.toBe(
      firstPrimary,
    );

    fixture.destroy();
    expect(overlayStyle.getPropertyValue('--mat-sys-primary')).toBe(
      'original-primary',
    );
    expect(overlayStyle.getPropertyPriority('--mat-sys-primary')).toBe(
      'important',
    );
    expect(overlayStyle.getPropertyValue('--mat-sys-on-primary')).toBe('');
    expect(overlayStyle.getPropertyValue('--color-primary')).toBe('');
    expect(overlayStyle.getPropertyValue('--unrelated-overlay-setting')).toBe(
      'preserved',
    );
  });

  it('returns overlays to the app theme when an event has no color', async () => {
    const fixture = TestBed.createComponent(ThemedPage);
    await fixture.whenStable();
    const overlayStyle =
      TestBed.inject(OverlayContainer).getContainerElement().style;
    expect(overlayStyle.getPropertyValue('--mat-sys-primary')).not.toBe('');
    fixture.componentInstance.color.set(undefined);
    await fixture.whenStable();
    expect(overlayStyle.getPropertyValue('--mat-sys-primary')).toBe('');
    expect(overlayStyle.getPropertyValue('--color-primary')).toBe('');
  });
});
