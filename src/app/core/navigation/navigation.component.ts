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
import { RouterLink, RouterLinkActive } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faCalendarDays,
  faEllipsisVertical,
  faFolderGear,
  faFolders,
  faLockKeyhole,
  faRightFromBracket,
  faRightToBracket,
  faUser,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../queries.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  private readonly queries = inject(QueriesService);
  protected readonly authenticationQuery = injectQuery(
    this.queries.isAuthenticated(),
  );
  protected readonly faCalendarDays = faCalendarDays;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly faFolderGear = faFolderGear;
  protected readonly faFolders = faFolders;
  protected readonly faLockKeyhole = faLockKeyhole;
  protected readonly faRightFromBracket = faRightFromBracket;
  protected readonly faRightToBracket = faRightToBracket;
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
