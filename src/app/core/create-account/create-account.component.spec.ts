import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CreateAccountComponent,
  CreateAccountOperations,
} from './create-account.component';

const loadAuthData = vi.fn();
const loadRequirements = vi.fn();

const normalizeText = (fixture: ComponentFixture<CreateAccountComponent>) =>
  fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

describe('CreateAccountComponent load recovery', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: 0,
          retry: false,
        },
      },
    });

    await TestBed.configureTestingModule({
      imports: [CreateAccountComponent],
      providers: [
        provideTanStackQuery(queryClient),
        {
          provide: CreateAccountOperations,
          useValue: {
            authData: () => ({
              queryFn: loadAuthData,
              queryKey: ['auth-data'],
            }),
            completeOnboarding: () => ({
              mutationFn: async () => true,
              mutationKey: ['complete-onboarding'],
            }),
            maybeSelfFilter: () => ({ queryKey: ['maybe-self'] }),
            onboardingRequirements: () => ({
              queryFn: loadRequirements,
              queryKey: ['onboarding-requirements'],
            }),
            onboardingStatusFilter: () => ({
              queryKey: ['onboarding-status'],
            }),
            selfFilter: () => ({ queryKey: ['self'] }),
          },
        },
        {
          provide: Router,
          useValue: { navigate: vi.fn() },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it('announces a failed login-details load and retries before showing the form', async () => {
    loadRequirements.mockResolvedValue({
      complete: false,
      hasMembership: false,
      policy: {
        id: 'policy-1',
        privacyPolicyText: 'Current policy',
        privacyPolicyUrl: null,
        version: 1,
      },
      profile: null,
      questions: [],
      tenantId: 'tenant-1',
      tenantName: 'Example Section',
    });
    loadAuthData
      .mockRejectedValueOnce(new Error('Auth profile unavailable'))
      .mockResolvedValue({
        email: 'alex@example.org',
        email_verified: true,
        family_name: 'Morgan',
        given_name: 'Alex',
      });

    const fixture = TestBed.createComponent(CreateAccountComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain(
        'Tenant setup could not be loaded',
      );
    });

    const alert: HTMLElement | null =
      fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      "Your verified login details or this tenant's current requirements are unavailable.",
    );

    const retryButton: HTMLButtonElement | null =
      fixture.nativeElement.querySelector('button');
    expect(retryButton?.textContent?.trim()).toBe('Try again');
    retryButton?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Notification email');
    });
    expect(loadAuthData).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });
});
