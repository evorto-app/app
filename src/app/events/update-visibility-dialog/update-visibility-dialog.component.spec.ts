import '@angular/compiler';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSelectHarness } from '@angular/material/select/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { beforeEach, describe, expect, it } from 'vitest';

import { UpdateVisibilityDialogComponent } from './update-visibility-dialog.component';

describe('UpdateVisibilityDialogComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UpdateVisibilityDialogComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: MAT_DIALOG_DATA,
          useValue: {
            event: {
              listingAudience: 'organizer',
              title: 'Welcome week',
            },
          },
        },
      ],
    }).compileComponents();
  });

  it('shows every explicit audience and the semantics of the current selection', async () => {
    const fixture = TestBed.createComponent(UpdateVisibilityDialogComponent);
    fixture.detectChanges();
    const select =
      await TestbedHarnessEnvironment.loader(fixture).getHarness(
        MatSelectHarness,
      );
    await select.open();
    const options = await select.getOptions();
    const text = fixture.nativeElement.textContent
      .replaceAll(/\s+/g, ' ')
      .trim();

    expect(text).toContain('Update listing for Welcome week');
    expect(await select.getValueText()).toBe('Organizers');
    expect(
      await Promise.all(options.map((option) => option.getText())),
    ).toEqual([
      'Participants',
      'Organizers',
      'Participants and organizers',
      'Unlisted',
    ]);
    expect(text).toContain(
      'Visible to people eligible for at least one organizer registration option.',
    );
  });
});
