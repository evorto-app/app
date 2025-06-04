import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  selector: 'app-not-allowed',
  styles: ``,
  templateUrl: './not-allowed.component.html',
})
export class NotAllowedComponent {}
