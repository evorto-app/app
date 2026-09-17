import '@angular/compiler';
import { OverlayContainer } from '@angular/cdk/overlay';
import { ChangeDetectorRef, getDebugNode, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MAT_DIALOG_DEFAULT_OPTIONS,
  MatDialog,
  MatDialogRef,
} from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { createRpcQueryFilter } from '@heddendorp/effect-angular-query';
import {
  RpcForbiddenError,
  RpcInternalServerError,
} from '@shared/errors/rpc-errors';
import { Permission } from '@shared/permissions/permissions';
import { TemplateCategoryNotFoundError } from '@shared/rpc-contracts/app-rpcs/template-categories.errors';
import { TemplateCategoryRecord } from '@shared/rpc-contracts/app-rpcs/template-categories.rpcs';
import { TemplatesByCategoryRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../../core/config.service';
import {
  APP_RPC_CLIENT,
  AppRpc,
} from '../../../core/effect-rpc-angular-client';
import { IconSelectorFieldComponent } from '../../../shared/components/controls/icon-selector/icon-selector-field/icon-selector-field.component';
import { CreateEditCategoryDialogComponent } from '../create-edit-category-dialog/create-edit-category-dialog.component';
import {
  CategoryListComponent,
  templateCategoryActionDisabled,
  templateCategoryColumns,
  templateCategoryMutationErrorMessage,
} from './category-list.component';

describe('templateCategoryActionDisabled', () => {
  it('blocks category actions while any category write is pending', () => {
    expect(
      templateCategoryActionDisabled({
        canManageCategories: true,
        createPending: false,
        updatePending: false,
      }),
    ).toBe(false);
    expect(
      templateCategoryActionDisabled({
        canManageCategories: true,
        createPending: true,
        updatePending: false,
      }),
    ).toBe(true);
    expect(
      templateCategoryActionDisabled({
        canManageCategories: true,
        createPending: false,
        updatePending: true,
      }),
    ).toBe(true);
  });

  it('blocks category actions when the capability is absent', () => {
    expect(
      templateCategoryActionDisabled({
        canManageCategories: false,
        createPending: false,
        updatePending: false,
      }),
    ).toBe(true);
  });
});

describe('template category permission presentation', () => {
  it('omits the action column for read-only users', () => {
    expect(templateCategoryColumns(false)).toEqual(['category', 'templates']);
    expect(templateCategoryColumns(true)).toEqual([
      'category',
      'templates',
      'actions',
    ]);
  });

  it('explains a server-side permission denial with a recovery step', () => {
    expect(
      templateCategoryMutationErrorMessage({
        _tag: 'RpcForbiddenError',
        message: 'Forbidden',
        permission: 'templates:manageCategories',
      }),
    ).toBe(
      'You can no longer manage template categories. No change was saved. Ask an administrator if you need this access.',
    );
  });

  it('gives recovery steps for a missing category', () => {
    expect(
      templateCategoryMutationErrorMessage({
        _tag: 'TemplateCategoryNotFoundError',
        message: 'Category not found',
      }),
    ).toBe(
      'This category could not be found. Your entries are still here. Copy anything you need, then cancel and reload the category list.',
    );
  });
  it('uses focused fallback copy for other mutation failures', () => {
    expect(
      templateCategoryMutationErrorMessage({
        message: 'Category not found',
      }),
    ).toBe(
      'The save outcome could not be confirmed. Check the category list before trying again. Your entries are still here.',
    );
  });

  it('shows a missing category without exposing internal failures', () => {
    expect(
      templateCategoryMutationErrorMessage({
        _tag: 'TemplateCategoryNotFoundError',
        message: 'This template category could not be found.',
      }),
    ).toBe(
      'This category could not be found. Your entries are still here. Copy anything you need, then cancel and reload the category list.',
    );
    expect(
      templateCategoryMutationErrorMessage({
        _tag: 'RpcInternalServerError',
        message: 'database failed',
      }),
    ).toBe(
      'The save outcome could not be confirmed. Check the category list before trying again. Your entries are still here.',
    );
  });
});

describe('template category uncertain permission-shaped error', () => {
  it('does not claim that no change was saved for an unrecognized permission-shaped error', () => {
    expect(
      templateCategoryMutationErrorMessage({
        _tag: 'RpcInternalServerError',
        message: 'Private error',
        permission: 'templates:manageCategories',
      }),
    ).toBe(
      'The save outcome could not be confirmed. Check the category list before trying again. Your entries are still here.',
    );
  });
});

describe('CategoryListComponent save outcomes', () => {
  type Client = ReturnType<typeof AppRpc.injectClient>;
  type CreateMutation = NonNullable<
    ReturnType<
      Client['templateCategories']['create']['mutationOptions']
    >['mutationFn']
  >;
  type UpdateMutation = NonNullable<
    ReturnType<
      Client['templateCategories']['update']['mutationOptions']
    >['mutationFn']
  >;
  const category: TemplateCategoryRecord = {
    icon: { iconColor: 2, iconName: 'calendar:fas' },
    id: 'category-1',
    title: 'Existing category',
  };
  const entered = {
    icon: { iconColor: 5, iconName: 'heart:fas' },
    title: 'Retained category title',
  };
  const unknownMessage =
    'The save outcome could not be confirmed. Check the category list before trying again. Your entries are still here.';
  const savedMessage =
    'The category was saved, but the category list could not be updated. Close this dialog and load the category list again to see the saved details.';
  const create = vi.fn<CreateMutation>();
  const update = vi.fn<UpdateMutation>();
  const findGroups =
    vi.fn<() => Promise<readonly TemplatesByCategoryRecord[]>>();
  const findCategories =
    vi.fn<() => Promise<readonly TemplateCategoryRecord[]>>();
  const permissions = signal<Permission[]>(['templates:manageCategories']);
  let fixture: ComponentFixture<CategoryListComponent>;
  let queryClient: QueryClient;
  let dialog: MatDialog;
  let cleanupDialog: MatDialog | undefined;
  let cleanupQueryClient: QueryClient | undefined;
  let root: HTMLElement;
  let overlay: HTMLElement;
  let operations: Promise<PromiseSettledResult<void>>[];

  const button = (container: HTMLElement, text: string) => {
    const result = [
      ...container.querySelectorAll<HTMLButtonElement>('button'),
    ].find((element) => element.textContent?.trim() === text);
    if (!result) throw new Error(`Expected the ${text} button.`);
    return result;
  };
  const openEditor = async (mode: 'create' | 'edit') => {
    button(root, mode === 'create' ? 'Create category' : 'Edit').click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(dialog.openDialogs).toHaveLength(1);
      expect(
        overlay.querySelector('app-create-edit-category-dialog'),
      ).not.toBeNull();
    });
    const element = overlay.querySelector<HTMLElement>(
      'app-create-edit-category-dialog',
    );
    if (!element) throw new Error('Expected the actual category dialog.');
    const debug = getDebugNode(element);
    if (!debug) throw new Error('Expected the dialog debug node.');
    const component = debug.injector.get(CreateEditCategoryDialogComponent);
    const dialogRef = debug.injector.get(
      MatDialogRef<CreateEditCategoryDialogComponent, undefined>,
    );
    const changeDetector = debug.injector.get(ChangeDetectorRef);
    const submit = vi.spyOn(component, 'onSubmit');
    const detect = () => {
      fixture.detectChanges();
      changeDetector.detectChanges();
    };
    const title = element.querySelector<HTMLInputElement>('input');
    if (!title) throw new Error('Expected the category title input.');
    expect(title.value).toBe(mode === 'create' ? '' : category.title);
    title.value = entered.title;
    title.dispatchEvent(new Event('input', { bubbles: true }));
    const iconElement = element.querySelector('app-icon-selector-field');
    if (!iconElement) throw new Error('Expected the real icon form control.');
    const iconDebug = getDebugNode(iconElement);
    if (!iconDebug) throw new Error('Expected the icon control debug node.');
    const icon = iconDebug.injector.get(IconSelectorFieldComponent);
    icon.value.set(entered.icon);
    await vi.waitFor(() => {
      detect();
      expect(button(element, 'Save').disabled).toBe(false);
    });
    const submitForm = () => {
      const formElement = element.querySelector('form');
      if (!formElement) throw new Error('Expected the category form.');
      formElement.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
      const result = submit.mock.results.at(-1);
      if (result?.type !== 'return')
        throw new Error('Expected the real submit operation.');
      const operation = result.value;
      operations.push(
        operation.then<PromiseSettledResult<void>, PromiseSettledResult<void>>(
          () => ({ status: 'fulfilled', value: undefined }),
          (error) => ({ reason: error, status: 'rejected' }),
        ),
      );
      return operation;
    };
    const expectRetained = () => {
      expect(title.value).toBe(entered.title);
      expect(JSON.stringify(icon.value())).toBe(JSON.stringify(entered.icon));
      if (mode === 'create') {
        expect(create).toHaveBeenCalledOnce();
        expect(create.mock.calls[0]?.[0]).toEqual(entered);
        expect(update).not.toHaveBeenCalled();
      } else {
        expect(update).toHaveBeenCalledOnce();
        expect(update.mock.calls[0]?.[0]).toEqual({
          ...entered,
          id: category.id,
        });
        expect(create).not.toHaveBeenCalled();
      }
      expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
    };
    const expectMessage = async (message: string) => {
      await vi.waitFor(() => {
        detect();
        expect(element.querySelector('[role="alert"]')?.textContent).toContain(
          message,
        );
      });
      expectRetained();
    };
    return {
      component,
      detect,
      dialogRef,
      element,
      expectMessage,
      expectRetained,
      icon,
      submitForm,
      title,
    };
  };

  beforeEach(async () => {
    cleanupDialog = undefined;
    cleanupQueryClient = undefined;
    operations = [];
    permissions.set(['templates:manageCategories']);
    create.mockReset().mockResolvedValue(undefined);
    update.mockReset().mockResolvedValue(category);
    findGroups.mockReset().mockResolvedValue([{ ...category, templates: [] }]);
    findCategories.mockReset().mockResolvedValue([category]);
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { gcTime: 0, retry: false },
        queries: { gcTime: 0, retry: false, staleTime: Infinity },
      },
    });
    cleanupQueryClient = queryClient;
    await TestBed.configureTestingModule({
      imports: [CategoryListComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: MAT_DIALOG_DEFAULT_OPTIONS,
          useValue: {
            disableClose: false,
            enterAnimationDuration: 0,
            exitAnimationDuration: 0,
          },
        },
        {
          provide: ConfigService,
          useValue: { permissionsSignal: permissions } satisfies Pick<
            ConfigService,
            'permissionsSignal'
          >,
        },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            queryFilter: createRpcQueryFilter,
            templateCategories: {
              create: {
                mutationOptions: (): ReturnType<
                  Client['templateCategories']['create']['mutationOptions']
                > => ({ mutationFn: create }),
              },
              findMany: {
                queryOptions: (): ReturnType<
                  Client['templateCategories']['findMany']['queryOptions']
                > => ({
                  queryFn: findCategories,
                  queryKey: [
                    ['templateCategories', 'findMany'],
                    { type: 'query' },
                  ],
                }),
              },
              update: {
                mutationOptions: (): ReturnType<
                  Client['templateCategories']['update']['mutationOptions']
                > => ({ mutationFn: update }),
              },
            },
            templates: {
              groupedByCategory: {
                queryOptions: (): ReturnType<
                  Client['templates']['groupedByCategory']['queryOptions']
                > => ({
                  queryFn: findGroups,
                  queryKey: [
                    ['templates', 'groupedByCategory'],
                    { type: 'query' },
                  ],
                }),
              },
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CategoryListComponent);
    const nativeElement: unknown = fixture.nativeElement;
    if (!(nativeElement instanceof HTMLElement))
      throw new Error('Expected the category-list component root.');
    root = nativeElement;
    dialog = TestBed.inject(MatDialog);
    cleanupDialog = dialog;
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(root.textContent).toContain(category.title);
      expect(findGroups).toHaveBeenCalledOnce();
    });
  });

  afterEach(async () => {
    const results = await Promise.all(operations);
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    const ownedDialog = cleanupDialog;
    try {
      ownedDialog?.closeAll();
    } catch (error) {
      failures.push(error);
    }
    if (ownedDialog) {
      try {
        await vi.waitFor(() => expect(ownedDialog.openDialogs).toHaveLength(0));
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      TestBed.resetTestingModule();
    } catch (error) {
      failures.push(error);
    }
    try {
      cleanupQueryClient?.clear();
    } catch (error) {
      failures.push(error);
    }
    try {
      vi.restoreAllMocks();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Category dialog operations or cleanup failed',
      );
  });

  for (const mode of ['create', 'edit'] as const) {
    it(`${mode}: retains title and icon after a simulated committed write loses its response`, async () => {
      let simulatedCommit = false;
      const fail = async () => {
        simulatedCommit = true;
        throw new Error('Test-local response lost after commit');
      };
      if (mode === 'create') create.mockImplementationOnce(fail);
      else update.mockImplementationOnce(fail);
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      const editor = await openEditor(mode);
      await editor.submitForm();
      expect(simulatedCommit).toBe(true);
      await editor.expectMessage(unknownMessage);
      expect(editor.title.disabled).toBe(false);
      expect(editor.icon.disabled()).toBe(false);
      expect(button(editor.element, 'Save').disabled).toBe(false);
      expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe(
        'error',
      );
      expect(invalidate).not.toHaveBeenCalled();
      expect(findGroups).toHaveBeenCalledOnce();
      await fixture.componentInstance.openCategoryCreationDialog();
      await fixture.componentInstance.openCategoryEditDialog(category);
      expect(dialog.openDialogs).toHaveLength(1);
    });

    it(`${mode}: keeps an internal mutation error unconfirmed without exposing its cause`, async () => {
      const error = new RpcInternalServerError({
        message: 'Private database detail',
      });
      if (mode === 'create') create.mockRejectedValueOnce(error);
      else update.mockRejectedValueOnce(error);
      const editor = await openEditor(mode);
      await editor.submitForm();
      await editor.expectMessage(unknownMessage);
      expect(editor.element.textContent).not.toContain(
        'Private database detail',
      );
      expect(editor.element.textContent).not.toContain('Private cause');
      expect(editor.element.textContent).not.toContain('No change was saved');
    });

    it(`${mode}: preserves entered values and actionable permission-denial guidance`, async () => {
      const error = new RpcForbiddenError({
        message: 'Forbidden',
        permission: 'templates:manageCategories',
      });
      if (mode === 'create') create.mockRejectedValueOnce(error);
      else update.mockRejectedValueOnce(error);
      const editor = await openEditor(mode);
      await editor.submitForm();
      await editor.expectMessage(
        'You can no longer manage template categories. No change was saved. Ask an administrator if you need this access.',
      );
      expect(button(editor.element, 'Save').disabled).toBe(false);
      expect(findGroups).toHaveBeenCalledOnce();
    });

    it(`${mode}: preserves a typed missing-category denial and its entered values`, async () => {
      const error = new TemplateCategoryNotFoundError({
        id: category.id,
        message: 'This template category could not be found.',
      });
      if (mode === 'create') create.mockRejectedValueOnce(error);
      else update.mockRejectedValueOnce(error);
      const editor = await openEditor(mode);
      await editor.submitForm();
      await editor.expectMessage(
        'This category could not be found. Your entries are still here. Copy anything you need, then cancel and reload the category list.',
      );
      expect(button(editor.element, 'Cancel').disabled).toBe(false);
      button(editor.element, 'Cancel').click();
      await vi.waitFor(() => expect(dialog.openDialogs).toHaveLength(0));
      expect(findGroups).toHaveBeenCalledOnce();
    });

    it(`${mode}: keeps confirmed save feedback visible when the actual active category read fails`, async () => {
      const editor = await openEditor(mode);
      findGroups.mockRejectedValueOnce(new Error('List read failed'));
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      await editor.submitForm();
      await editor.expectMessage(savedMessage);
      expect(findGroups).toHaveBeenCalledTimes(2);
      expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe(
        'success',
      );
      expect(button(editor.element, 'Close').disabled).toBe(false);
      expect(editor.element.querySelector('button[type="submit"]')).toBeNull();
      expect(editor.title.disabled).toBe(true);
      expect(editor.icon.disabled()).toBe(true);
      expect(invalidate).toHaveBeenCalledTimes(2);
      expect(invalidate).toHaveBeenCalledWith(
        createRpcQueryFilter(['templateCategories', 'findMany']),
        { throwOnError: true },
      );
      expect(invalidate).toHaveBeenCalledWith(
        createRpcQueryFilter(['templates', 'groupedByCategory']),
        { throwOnError: true },
      );
      await editor.submitForm();
      editor.expectRetained();
      expect(invalidate).toHaveBeenCalledTimes(2);
    });

    it(`${mode}: holds fields, Cancel, Escape and other category actions until both read attempts settle`, async () => {
      let releaseRead: () => void = () => {
        throw new Error('Expected the read gate to be initialized');
      };
      // Signal Forms tests compile for ES2022, which does not provide Promise.withResolvers.

      const heldRead = new Promise<undefined>((resolve) => {
        releaseRead = () => resolve(undefined);
      });
      const invalidate = vi
        .spyOn(queryClient, 'invalidateQueries')
        .mockRejectedValueOnce(new Error('First list read failed'))
        .mockImplementationOnce(() => heldRead);
      const editor = await openEditor(mode);
      const operation = editor.submitForm();
      try {
        await vi.waitFor(() => {
          editor.detect();
          expect(invalidate).toHaveBeenCalledTimes(2);
          expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe(
            'success',
          );
          expect(button(editor.element, 'Saving…').disabled).toBe(true);
        });
        expect(editor.title.disabled).toBe(true);
        expect(editor.icon.disabled()).toBe(true);
        expect(button(editor.element, 'Cancel').disabled).toBe(true);
        expect(editor.dialogRef.disableClose).toBe(true);
        expect(
          editor.element.querySelector('[role="status"]')?.textContent,
        ).toContain('Saving category and updating the list');
        expect(editor.element.querySelector('[role="alert"]')).toBeNull();
        button(editor.element, 'Cancel').click();
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', {
            bubbles: true,
            code: 'Escape',
            key: 'Escape',
            keyCode: 27,
          }),
        );
        await fixture.componentInstance.openCategoryCreationDialog();
        await fixture.componentInstance.openCategoryEditDialog(category);
        await editor.submitForm();
        editor.detect();
        expect(dialog.openDialogs).toHaveLength(1);
        editor.expectRetained();
        expect(invalidate).toHaveBeenCalledTimes(2);
      } finally {
        releaseRead();
        await operation;
      }
      await editor.expectMessage(savedMessage);
      expect(editor.dialogRef.disableClose).toBe(false);
      expect(button(editor.element, 'Close').disabled).toBe(false);
    });

    it(`${mode}: closes only after a confirmed save and successful reads, then releases category actions`, async () => {
      const editor = await openEditor(mode);
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      await editor.submitForm();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(dialog.openDialogs).toHaveLength(0);
        expect(button(root, 'Create category').disabled).toBe(false);
      });
      if (mode === 'create') {
        expect(create).toHaveBeenCalledOnce();
        expect(create.mock.calls[0]?.[0]).toEqual(entered);
        expect(update).not.toHaveBeenCalled();
      } else {
        expect(update).toHaveBeenCalledOnce();
        expect(update.mock.calls[0]?.[0]).toEqual({
          ...entered,
          id: category.id,
        });
        expect(create).not.toHaveBeenCalled();
      }
      expect(invalidate).toHaveBeenCalledTimes(2);
      expect(findGroups).toHaveBeenCalledTimes(2);
    });
  }

  it('locks category actions while the dialog is open and releases them when it is cancelled', async () => {
    const editor = await openEditor('edit');
    expect(button(root, 'Create category').disabled).toBe(true);
    await fixture.componentInstance.openCategoryCreationDialog();
    await fixture.componentInstance.openCategoryEditDialog(category);
    expect(dialog.openDialogs).toHaveLength(1);
    button(editor.element, 'Cancel').click();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(dialog.openDialogs).toHaveLength(0);
      expect(button(root, 'Create category').disabled).toBe(false);
    });
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps category actions and direct opens unavailable after management permission is removed', async () => {
    permissions.set([]);
    fixture.detectChanges();
    expect(root.textContent).toContain('You can view template categories.');
    expect(root.textContent).not.toContain('Create category');
    expect(root.textContent).not.toContain('Edit');
    await fixture.componentInstance.openCategoryCreationDialog();
    await fixture.componentInstance.openCategoryEditDialog(category);
    expect(dialog.openDialogs).toHaveLength(0);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
