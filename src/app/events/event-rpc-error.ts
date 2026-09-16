const eventRpcErrorTag = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const tag = Reflect.get(error, '_tag');
  return typeof tag === 'string' ? tag : undefined;
};

export const eventReviewActionErrorRequiresRefresh = (
  error: unknown,
): boolean => {
  const tag = eventRpcErrorTag(error);
  return tag === 'EventConflictError' || tag === 'EventNotFoundError';
};
