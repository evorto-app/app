import type { Permission } from '@shared/permissions/permissions';

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injectable,
  TemplateRef,
  viewChild,
} from '@angular/core';
import {
  MatBottomSheet,
  type MatBottomSheetConfig,
  MatBottomSheetModule,
} from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faCalendarDays,
  faEllipsisVertical,
  faFolderGear,
  faFolders,
  faHouseChimney,
  faLockKeyhole,
  faMoneyBill,
  faRightFromBracket,
  faRightToBracket,
  faScannerGun,
  faUser,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { IfAnyPermissionDirective } from '../../shared/directives/if-any-permission.directive';
import { IfPermissionDirective } from '../../shared/directives/if-permission.directive';
import { ConfigService } from '../config.service';
import { AppRpc } from '../effect-rpc-angular-client';
import { PermissionsService } from '../permissions.service';

export const mobileMoreNavigationAvailable = ({
  hasFinancePermission,
  hasInternalPermission,
  hasPlatformAuthority,
  hasTenantAdminPermission,
}: {
  readonly hasFinancePermission: boolean;
  readonly hasInternalPermission: boolean;
  readonly hasPlatformAuthority: boolean;
  readonly hasTenantAdminPermission: boolean;
}): boolean =>
  hasFinancePermission ||
  hasInternalPermission ||
  hasPlatformAuthority ||
  hasTenantAdminPermission;

export const mobileMoreNavigationLabel = 'More navigation';

export const mobileMoreNavigationSheetConfig = {
  ariaLabel: mobileMoreNavigationLabel,
} as const satisfies MatBottomSheetConfig;

@Injectable({ providedIn: 'root' })
export class NavigationOperations {
  private readonly rpc = AppRpc.injectClient();

  authenticationQueryOptions() {
    return this.rpc.config.isAuthenticated.queryOptions();
  }

  scannerAccessQueryOptions() {
    return this.rpc.users.canUseScanner.queryOptions();
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FontAwesomeModule,
    RouterLinkActive,
    MatBottomSheetModule,
    IfPermissionDirective,
    IfAnyPermissionDirective,
    MatButtonModule,
  ],
  selector: 'app-navigation',
  styles: `
    .navigation-current .navigation-link-indicator,
    .sheet-navigation-link.navigation-current {
      background-color: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }
  `,
  templateUrl: './navigation.component.html',
})
export class NavigationComponent {
  protected readonly adminNavigationPermissions: Permission[] = [
    'admin:manageRoles',
    'admin:changeSettings',
    'admin:tax',
    'users:viewAll',
    'events:review',
  ];
  private readonly operations = inject(NavigationOperations);
  protected readonly authenticationQuery = injectQuery(() =>
    this.operations.authenticationQueryOptions(),
  );
  protected readonly faCalendarDays = faCalendarDays;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly faFolderGear = faFolderGear;
  protected readonly faFolders = faFolders;
  protected readonly faHouseChimney = faHouseChimney;
  protected readonly faLockKeyhole = faLockKeyhole;
  protected readonly faMoneyBill = faMoneyBill;
  protected readonly faRightFromBracket = faRightFromBracket;
  protected readonly faRightToBracket = faRightToBracket;
  protected readonly faScannerGun = faScannerGun;
  protected readonly faUser = faUser;
  protected readonly platformAuthority =
    inject(ConfigService).platformAuthoritySignal;
  private readonly permissions = inject(PermissionsService);
  protected readonly mobileMoreNavigationAvailable = computed(() =>
    mobileMoreNavigationAvailable({
      hasFinancePermission: this.permissions.hasPermissionSync('finance:*'),
      hasInternalPermission: this.permissions.hasPermissionSync(
        'internal:viewInternalPages',
      ),
      hasPlatformAuthority: this.platformAuthority() !== null,
      hasTenantAdminPermission: this.adminNavigationPermissions.some(
        (permission) => this.permissions.hasPermissionSync(permission),
      ),
    }),
  );
  protected readonly scannerAccessQuery = injectQuery(() =>
    this.operations.scannerAccessQueryOptions(),
  );
  protected readonly sheetTemplate =
    viewChild<TemplateRef<unknown>>('navigationSheet');

  private readonly bottomSheet = inject(MatBottomSheet);

  closeSheet() {
    this.bottomSheet.dismiss();
  }

  openSheet() {
    const sheetTemplate = this.sheetTemplate();
    if (!sheetTemplate) {
      return;
    }
    this.bottomSheet.open(sheetTemplate, mobileMoreNavigationSheetConfig);
  }
}
