import { computed, Directive, HostBinding, input } from '@angular/core';
import {
  hexFromArgb,
  themeFromSourceColor,
} from '@material/material-color-utilities';

@Directive({
  selector: '[appMaterialTheme]',
  standalone: true,
})
export class MaterialThemeDirective {
  baseColor = input<number>();

  @HostBinding('style')
  get styleBinding() {
    return this.themeStyles();
  }

  protected readonly themeStyles = computed(() => {
    const color = this.baseColor();
    if (color === undefined) {
      return {};
    }

    const theme = themeFromSourceColor(color);
    const styles: Record<string, string> = {};

    const lightScheme = theme.schemes.light.toJSON();
    const darkScheme = theme.schemes.dark.toJSON();

    for (const key of Object.keys(lightScheme)) {
      const lightValue = lightScheme[key as keyof typeof lightScheme];
      const darkValue = darkScheme[key as keyof typeof darkScheme];
      const kebabKey = this.camelToKebab(key);

      styles[`--color-${kebabKey}`] =
        `light-dark(${hexFromArgb(lightValue)}, ${hexFromArgb(darkValue)})`;
      styles[`--mat-sys-${kebabKey}`] =
        `light-dark(${hexFromArgb(lightValue)}, ${hexFromArgb(darkValue)})`;
    }

    return styles;
  });

  private camelToKebab(string_: string): string {
    return string_
      .replaceAll(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2')
      .toLowerCase();
  }
}
