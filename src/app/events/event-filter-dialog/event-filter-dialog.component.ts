import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, ReactiveFormsModule],
  selector: 'app-event-filter-dialog',
  styles: ``,
  templateUrl: './event-filter-dialog.component.html',
})
export class EventFilterDialogComponent {
  private readonly formBuilder = inject(NonNullableFormBuilder);
  protected readonly filterForm = this.formBuilder.group({
    includeUnlisted: [],
    statusFilter: [],
  });
}
