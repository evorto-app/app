import {
  ChangeDetectionStrategy,
  Component,
  inject,
  TemplateRef,
  viewChild,
} from '@angular/core';
import {
  MatBottomSheet,
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

import type { Permission } from '../../../shared/permissions/permissions';

import { IfAnyPermissionDirective } from '../../shared/directives/if-any-permission.directive';
import { IfPermissionDirective } from '../../shared/directives/if-permission.directive';
import { AppRpc } from '../effect-rpc-angular-client';

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
  styles: ``,
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
  private readonly rpc = AppRpc.injectClient();
  protected readonly authenticationQuery = injectQuery(() =>
    this.rpc.config.isAuthenticated.queryOptions(),
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
  protected readonly scannerAccessQuery = injectQuery(() =>
    this.rpc.users.canUseScanner.queryOptions(),
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
    this.bottomSheet.open(sheetTemplate);
  }
}
