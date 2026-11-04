import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import {
  applyEach,
  disabled,
  form,
  FormField,
  maxLength,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { type HubResource, MAX_HUB_RESOURCES } from '@shared/hub-resources';
import { HubResourceIconUsage } from '@shared/rpc-contracts/app-rpcs/icons.rpcs';
import { isTenantFooterHref } from '@shared/tenant-footer-links';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { PermissionsService } from '../../core/permissions.service';
import { IconSelectorFieldComponent } from '../../shared/components/controls/icon-selector/icon-selector-field/icon-selector-field.component';
import { IconComponent } from '../../shared/components/icon/icon.component';

@Injectable({ providedIn: 'root' })
export class MembersHubQueries {
  private readonly rpc = AppRpc.injectClient();

  hubResources() {
    return this.rpc.admin.hub.findResources.queryOptions();
  }
  saveResources() {
    return this.rpc.admin.hub.saveResources.mutationOptions();
  }
  hubRoles() {
    return this.rpc.admin.roles.findHubRoles.queryOptions();
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block min-w-0 w-full p-4',
  },
  imports: [
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatListModule,
    IconComponent,
    IconSelectorFieldComponent,
  ],
  selector: 'app-members-hub',
  templateUrl: './members-hub.component.html',
})
export class MembersHubComponent {
  private readonly queries = inject(MembersHubQueries);
  protected readonly rolesQuery = injectQuery(() => this.queries.hubRoles());
  protected readonly resourcesQuery = injectQuery(() =>
    this.queries.hubResources(),
  );
  protected readonly saveMutation = injectMutation(() =>
    this.queries.saveResources(),
  );
  protected readonly canManage = inject(PermissionsService).hasPermission(
    'internal:manageResources',
  );
  protected readonly editingResources = signal(false);
  protected readonly resourceError = signal('');
  protected readonly resourceIconUsage = HubResourceIconUsage.make({});
  protected readonly maxResources = MAX_HUB_RESOURCES;
  protected readonly resourceModel = signal<{ resources: HubResource[] }>({
    resources: [],
  });
  private expectedResources: readonly HubResource[] = [];
  protected readonly resourceForm = form(this.resourceModel, (fields) => {
    disabled(fields, () => this.saveMutation.isPending());
    applyEach(fields.resources, (resource) => {
      required(resource.label, { message: 'Enter a resource name.' });
      maxLength(resource.label, 80);
      validate(resource.label, ({ value }) =>
        value().trim()
          ? undefined
          : { kind: 'blank', message: 'Enter a resource name.' },
      );
      required(resource.href, { message: 'Enter a link.' });
      validate(resource.href, ({ value }) =>
        isTenantFooterHref(value().trim())
          ? undefined
          : {
              kind: 'url',
              message:
                'Enter an http://, https://, or mailto: link without credentials.',
            },
      );
    });
  });
  protected beginResourceEdit() {
    if (!this.canManage() || !this.resourcesQuery.isSuccess()) return;
    this.expectedResources = this.resourcesQuery.data();
    this.resourceModel.set({
      resources: this.expectedResources.map((resource) => ({ ...resource })),
    });
    this.resourceError.set('');
    this.resourceForm().reset();
    this.editingResources.set(true);
  }
  protected cancelResourceEdit() {
    if (this.saveMutation.isPending()) return;
    this.editingResources.set(false);
    this.resourceError.set('');
    void this.resourcesQuery.refetch();
  }
  protected addResource() {
    if (
      this.saveMutation.isPending() ||
      this.resourceModel().resources.length >= MAX_HUB_RESOURCES
    )
      return;
    this.resourceModel.update((model) => ({
      resources: [
        ...model.resources,
        { href: '', icon: { iconColor: 0, iconName: 'link' }, label: '' },
      ],
    }));
  }
  protected removeResource(index: number) {
    if (this.saveMutation.isPending()) return;
    this.resourceModel.update((model) => ({
      resources: model.resources.filter((_, i) => i !== index),
    }));
  }
  protected moveResource(index: number, direction: -1 | 1) {
    if (this.saveMutation.isPending()) return;
    this.resourceModel.update((model) => {
      const resources = [...model.resources];
      const moved = resources[index];
      if (!moved || !resources[index + direction]) return model;
      resources.splice(index, 1);
      resources.splice(index + direction, 0, moved);
      return { resources };
    });
  }
  protected async saveResources(event: Event) {
    event.preventDefault();
    if (!this.canManage() || this.saveMutation.isPending()) return;
    await submit(this.resourceForm, async () => {
      this.resourceError.set('');
      try {
        await this.saveMutation.mutateAsync({
          expectedResources: this.expectedResources,
          resources: this.resourceModel().resources.map((resource) => ({
            ...resource,
            href: resource.href.trim(),
            label: resource.label.trim(),
          })),
        });
        await this.resourcesQuery.refetch();
        this.editingResources.set(false);
      } catch (error) {
        this.resourceError.set(
          getErrorMessage(error, 'Resources could not be saved. Try again.', [
            'HubResourcesConflictError',
          ]),
        );
      }
    });
  }
}
