import { inject } from '@angular/core';
import { ResolveFn } from '@angular/router';
import { QueryClient } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../core/effect-rpc-angular-client';

export const templateTitleResolver: ResolveFn<string> = async (route) => {
  const templateId = route.paramMap.get('templateId');
  if (!templateId) throw new Error('Template route is missing its template ID');
  const rpc = AppRpc.injectClient();
  const queryClient = inject(QueryClient);
  const options = rpc.templates.findOne.queryOptions({ id: templateId });
  await queryClient.prefetchQuery(options);
  const template = queryClient.getQueryData<
    Awaited<ReturnType<typeof rpc.templates.findOne.call>>
  >(options.queryKey);
  if (
    !template ||
    queryClient.getQueryState(options.queryKey)?.status !== 'success'
  )
    return 'Template unavailable';
  const action = route.data['templateTitleAction'];
  return typeof action === 'string'
    ? `${action} ${template.title}`
    : template.title;
};
