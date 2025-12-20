import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  OnDestroy,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom, startWith, Subscription } from 'rxjs';

import { injectNgControl } from '../../../../../utils';
import { NoopValueAccessorDirective } from '../../../../directives/noop-value-accessor.directive';
import { IconComponent } from '../../../icon/icon.component';
import { IconSelectorDialogComponent } from '../icon-selector-dialog/icon-selector-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [NoopValueAccessorDirective],
  imports: [IconComponent, MatButtonModule, MatDialogModule],
  selector: 'app-icon-selector-field',
  styles: ``,
  templateUrl: './icon-selector-field.component.html',
})
export class IconSelectorFieldComponent implements AfterViewInit, OnDestroy {
  protected iconValue = signal<string | { iconColor: number; iconName: string }>('');

  protected ngControl = injectNgControl();

  private dialog = inject(MatDialog);
  private signalSubscription: Subscription | undefined;

  ngAfterViewInit(): void {
    this.signalSubscription = this.ngControl.valueChanges
      ?.pipe(startWith(this.ngControl.value))
      .subscribe((icon) => {
        this.iconValue.set(icon as string | { iconColor: number; iconName: string });
      });
  }

  ngOnDestroy(): void {
    this.signalSubscription?.unsubscribe();
  }

  async openSelectionDialog() {
    const icon = await firstValueFrom(
      this.dialog.open(IconSelectorDialogComponent, { minWidth: '70dvw' }).afterClosed(),
    );
    if (icon) {
      this.ngControl.control.patchValue(icon);
    }
  }
}
