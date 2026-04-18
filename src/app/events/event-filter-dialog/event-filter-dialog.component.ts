import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule],
  selector: 'app-event-filter-dialog',
  styles: ``,
  templateUrl: './event-filter-dialog.component.html',
})
export class EventFilterDialogComponent {}
