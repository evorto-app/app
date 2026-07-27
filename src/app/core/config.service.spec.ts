import { PLATFORM_ID, REQUEST_CONTEXT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ConfigService,
  ServerRequestContextRequiredError,
} from './config.service';
import { APP_RPC_CLIENT } from './effect-rpc-angular-client';

describe('ConfigService server initialization', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('fails visibly when Angular did not provide request context', async () => {
    const publicConfigCall = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    TestBed.configureTestingModule({
      providers: [
        ConfigService,
        provideTanStackQuery(queryClient),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: REQUEST_CONTEXT, useValue: null },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            config: {
              public: {
                call: publicConfigCall,
              },
              tenant: {
                queryOptions: () => ({
                  enabled: false,
                  queryFn: vi.fn(),
                  queryKey: ['config', 'tenant'],
                }),
              },
            },
          },
        },
      ],
    });

    const config = TestBed.inject(ConfigService);

    await expect(config.initialize()).rejects.toBeInstanceOf(
      ServerRequestContextRequiredError,
    );
    expect(publicConfigCall).not.toHaveBeenCalled();
    queryClient.clear();
  });
});
