import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';

import { GaOverviewComponent } from './ga-overview.component';

describe('GaOverviewComponent', () => {
  it('links to email delivery using user-facing language', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([])],
    });

    const fixture = TestBed.createComponent(GaOverviewComponent);
    await fixture.whenStable();

    const links = [
      ...(
        fixture.nativeElement as HTMLElement
      ).querySelectorAll<HTMLAnchorElement>('a'),
    ];
    const emailDeliveryLink = links.find(
      (link) => link.textContent?.trim() === 'Email delivery',
    );

    expect(emailDeliveryLink?.getAttribute('href')).toBe('/email-delivery');
    expect(fixture.nativeElement.textContent).not.toContain('Email outbox');
  });
});
