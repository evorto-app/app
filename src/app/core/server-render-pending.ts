import { isPlatformServer } from '@angular/common';
import {
  DestroyRef,
  effect,
  inject,
  PendingTasks,
  PLATFORM_ID,
} from '@angular/core';

/** Keep SSR open until query results reach Angular's signals, not just HTTP completion.
 * Call in an injection context. Exclude intentionally disabled queries from the predicate.
 */
export const holdServerRenderWhile = (isPending: () => boolean): void => {
  if (!isPlatformServer(inject(PLATFORM_ID))) return;
  const pendingTasks = inject(PendingTasks);
  let complete: (() => void) | undefined = pendingTasks.add();
  inject(DestroyRef).onDestroy(() => complete?.());
  effect(() => {
    if (isPending()) {
      complete ??= pendingTasks.add();
    } else {
      complete?.();
      complete = undefined;
    }
  });
};
