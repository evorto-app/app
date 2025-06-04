import type { AnyRouter } from '@trpc/server';

import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { createTRPCClient, TRPCClientError, TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import superjson, { SuperJSONResult } from 'superjson';

import { AppRouter } from '../../server/trpc/app-router';
import { TRPC_CLIENT } from './trpc-token';

export interface AngularLinkOptions {
  url: string;
}

const angularLink = (http: HttpClient) => {
  return <TRouter extends AnyRouter>(
    options: AngularLinkOptions,
  ): TRPCLink<TRouter> => {
    return () =>
      ({ op }) =>
        observable((observer) => {
          const url = `${options.url}/${op.path}`;
          switch (op.type) {
            case 'mutation': {
              http
                .post<{
                  result: { data: SuperJSONResult };
                }>(url, superjson.serialize(op.input))
                .subscribe({
                  error: (error) => {
                    console.warn('Error in mutation');
                    if (error.status !== 0) {
                      const parsedError = superjson.deserialize(
                        error.error.error,
                      ) as TRPCClientError<AppRouter>;
                      console.error(parsedError);
                      observer.error(parsedError);
                    }
                    console.error(error);
                    observer.error(error);
                  },
                  next: (response) => {
                    const parsedResponse = superjson.deserialize(
                      response.result.data,
                    );
                    observer.next({
                      result: {
                        data: parsedResponse,
                        type: 'data',
                      },
                    });
                    observer.complete();
                  },
                });
              break;
            }
            case 'subscription': {
              throw new Error('Subscriptions are not supported');
            }
            case 'query': {
              http
                .get<{
                  result: { data: SuperJSONResult };
                }>(url, {
                  params: {
                    input: JSON.stringify(superjson.serialize(op.input)),
                  },
                })
                .subscribe({
                  error: (error) => {
                    console.warn('Error in query');
                    if (error.status !== 0) {
                      try {
                        const parsedError = superjson.deserialize(
                          error.error.error,
                        ) as TRPCClientError<AppRouter>;
                        console.error(parsedError);
                        observer.error(parsedError);
                      } catch (error_) {
                        console.error(error_);
                      }
                    }
                    console.error(error);
                    observer.error(error);
                  },
                  next: (response) => {
                    if (response?.result?.data === undefined) {
                      const error = new TRPCClientError('No data in response', {
                        meta: { response },
                      });
                      console.error(error);
                      observer.error(error);
                      return;
                    }
                    const parsedResponse = superjson.deserialize(
                      response.result.data,
                    );
                    observer.next({
                      result: {
                        data: parsedResponse,
                        type: 'data',
                      },
                    });
                    observer.complete();
                  },
                });
              break;
            }
          }
        });
  };
};

export const provideTrpcClient = () => {
  return {
    deps: [HttpClient],
    provide: TRPC_CLIENT,
    useFactory: (http: HttpClient) => {
      const link = angularLink(http);
      return createTRPCClient<AppRouter>({
        links: [link({ url: '/trpc' })],
      });
    },
  };
};

export function injectTrpcClient() {
  return inject(TRPC_CLIENT);
}
