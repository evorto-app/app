import { inject, Injectable } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private snackBar = inject(MatSnackBar);

  showError(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 5000,
      panelClass: 'error-snackbar',
    });
  }

  showEventReviewed(approved: boolean, eventTitle: string): void {
    const message = approved
      ? `Event "${eventTitle}" has been approved`
      : `Event "${eventTitle}" has been rejected`;

    this.snackBar.open(message, 'Close', {
      duration: 5000,

      panelClass: approved ? 'success-snackbar' : 'error-snackbar',
    });
  }

  showEventSubmitted(eventTitle: string): void {
    this.snackBar.open(
      `Event "${eventTitle}" has been submitted for review`,
      'Close',
      {
        duration: 0,

        panelClass: 'info-snackbar',
      },
    );
  }

  showSuccess(message: string): void {
    this.snackBar.open(message, 'Close', {
      duration: 5000,
      panelClass: 'success-snackbar',
    });
  }
}
