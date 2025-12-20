import { NgOptimizedImage } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  numberAttribute,
} from '@angular/core';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'shrink-0',
  },
  imports: [NgOptimizedImage],
  selector: 'app-icon',
  templateUrl: './icon.component.html',
})
export class IconComponent {
  public iconCommonName = input.required<string | { iconColor: number; iconName: string }>();
  public size = input(24, {
    transform: numberAttribute,
  });
  protected iconName = computed(() => {
    const value = this.iconCommonName();
    const commonName = typeof value === 'string' ? value : value.iconName;
    const [name] = (commonName ?? '').split(':');
    return name || 'nothing-found';
  });
  protected iconSet = computed(() => {
    const value = this.iconCommonName();
    const commonName = typeof value === 'string' ? value : value.iconName;
    const [, set] = (commonName ?? '').split(':');
    return set || 'fluent';
  });
  protected iconUrl = computed(() => {
    const name = this.iconName();
    const set = this.iconSet();
    return `https://img.icons8.com/${set}/192/${name}.png`;
  });
}
