import { ChangeDetectionStrategy, Component, inject, TemplateRef, viewChild } from '@angular/core';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
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

import { injectTRPC } from '../../core/trpc-client';
import { IfPermissionDirective } from '../../shared/directives/if-permission.directive';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FontAwesomeModule,
    RouterLinkActive,
    MatBottomSheetModule,
    IfPermissionDirective,
    MatButtonModule,
  ],
  selector: 'app-navigation',
  styles: ``,
  templateUrl: './navigation.component.html',
})
export class NavigationComponent {
  private readonly trpc = injectTRPC();
  protected readonly authenticationQuery = injectQuery(() =>
    this.trpc.config.isAuthenticated.queryOptions(),
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
  protected readonly sheetTemplate = viewChild<TemplateRef<unknown>>('navigationSheet');

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
