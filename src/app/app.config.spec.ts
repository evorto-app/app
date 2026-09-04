import { TestBed } from '@angular/core/testing';
import { IS_DISCOVERING_ROUTES } from '@angular/ssr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeApplicationConfig } from './app.config';
import { ConfigService } from './core/config.service';

describe('application configuration initialization', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('does not construct ConfigService during route discovery', async () => {
    const configFactory = vi.fn(() => ({
      initialize: vi.fn(),
    }));
    TestBed.configureTestingModule({
      providers: [
        { provide: IS_DISCOVERING_ROUTES, useValue: true },
        { provide: ConfigService, useFactory: configFactory },
      ],
    });

    await TestBed.runInInjectionContext(initializeApplicationConfig);

    expect(configFactory).not.toHaveBeenCalled();
  });

  it('initializes ConfigService outside route discovery', async () => {
    const initialize = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: IS_DISCOVERING_ROUTES, useValue: false },
        { provide: ConfigService, useValue: { initialize } },
      ],
    });

    await TestBed.runInInjectionContext(initializeApplicationConfig);

    expect(initialize).toHaveBeenCalledOnce();
  });
});
