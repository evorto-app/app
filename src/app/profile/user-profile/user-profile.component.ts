import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faRightFromBracket } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, FontAwesomeModule],
  selector: 'app-user-profile',
  styles: ``,
  templateUrl: './user-profile.component.html',
})
export class UserProfileComponent {
  protected readonly faRightFromBracket = faRightFromBracket;
  private readonly queries = inject(QueriesService);
  protected readonly userQuery = injectQuery(this.queries.self());
}
