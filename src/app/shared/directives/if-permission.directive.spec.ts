import type { Permission } from '@shared/permissions/permissions';

import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { PermissionsService } from '../../core/permissions.service';
import { IfPermissionDirective } from './if-permission.directive';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IfPermissionDirective],
  template: `
    <button *appIfPermission="'templates:editAll'">Edit template</button>
  `,
})
class PermissionActionHostComponent {}

describe('IfPermissionDirective', () => {
  it('adds and removes a capability-scoped action when permissions change', async () => {
    const permissions = signal<Permission[]>([]);

    TestBed.configureTestingModule({
      imports: [PermissionActionHostComponent],
      providers: [
        PermissionsService,
        {
          provide: ConfigService,
          useValue: {
            get permissions() {
              return permissions();
            },
            permissionsSignal: permissions,
          } satisfies Pick<ConfigService, 'permissions' | 'permissionsSignal'>,
        },
      ],
    });

    const fixture = TestBed.createComponent(PermissionActionHostComponent);
    await fixture.whenStable();

    expect(fixture.debugElement.query(By.css('button'))).toBeNull();

    permissions.set(['templates:editAll']);
    await fixture.whenStable();

    expect(fixture.debugElement.query(By.css('button'))).not.toBeNull();

    permissions.set([]);
    await fixture.whenStable();

    expect(fixture.debugElement.query(By.css('button'))).toBeNull();
  });
});
