import { inject, Injectable } from '@angular/core';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';

import { ConfigService } from './config.service';

@Injectable()
export class PageTitleStrategy extends TitleStrategy {
  private readonly config = inject(ConfigService);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.config.updateTitle(this.buildTitle(snapshot) ?? null);
  }
}
