import { Component, inject, TemplateRef, viewChild } from '@angular/core';
import {
  MatBottomSheet,
  MatBottomSheetModule,
} from '@angular/material/bottom-sheet';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faCalendarDays,
  faEllipsisVertical,
  faFolderGear,
  faFolders,
  faLockKeyhole,
  faUser,
} from '@fortawesome/duotone-regular-svg-icons';

@Component({
  imports: [
    RouterLink,
    FontAwesomeModule,
    RouterLinkActive,
    MatBottomSheetModule,
  ],
  selector: 'app-navigation',
  styles: ``,
  templateUrl: './navigation.component.html',
})
export class NavigationComponent {
  protected readonly faCalendarDays = faCalendarDays;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly faFolderGear = faFolderGear;
  protected readonly faFolders = faFolders;
  protected readonly faLockKeyhole = faLockKeyhole;
  protected readonly faUser = faUser;
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
