const eventRpcErrorTag = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const tag = Reflect.get(error, '_tag');
  return typeof tag === 'string' ? tag : undefined;
};

export const eventRouteErrorPath = (
  error: unknown,
): '/403' | '/404' | '/500' => {
  switch (eventRpcErrorTag(error)) {
    case 'EventNotFoundError': {
      return '/404';
    }
    case 'RpcForbiddenError':
    case 'RpcUnauthorizedError': {
      return '/403';
    }
    default: {
      return '/500';
    }
  }
};

export const eventReviewActionErrorRequiresRefresh = (
  error: unknown,
): boolean => {
  const tag = eventRpcErrorTag(error);
  return tag === 'EventConflictError' || tag === 'EventNotFoundError';
};

export const eventLoadErrorTitle = (error: unknown): string => {
  switch (eventRpcErrorTag(error)) {
    case 'EventConflictError': {
      return 'Registration unavailable';
    }
    case 'EventNotFoundError': {
      return 'Event not found';
    }
    default: {
      return 'Event could not be loaded';
    }
  }
};
