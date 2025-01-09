import { NgOptimizedImage } from '@angular/common';
import { Component, computed, input, numberAttribute } from '@angular/core';

@Component({
  imports: [NgOptimizedImage],
  selector: 'app-icon',
  styles: ``,
  templateUrl: './icon.component.html',
})
export class IconComponent {
  public iconCommonName = input.required<string>();
  public size = input(24, {
    transform: numberAttribute,
  });
  protected iconName = computed(() => {
    const [name] = (this.iconCommonName() ?? '').split(':');
    return name || 'nothing-found';
  });
  protected iconSet = computed(() => {
    const [, set] = (this.iconCommonName() ?? '').split(':');
    return set || 'fluent';
  });
  protected iconUrl = computed(() => {
    const name = this.iconName();
    const set = this.iconSet();
    return `https://img.icons8.com/${set}/192/${name}.png`;
  });
}
