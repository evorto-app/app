import { OverlayContainer } from '@angular/cdk/overlay';
import { isPlatformBrowser } from '@angular/common';
import {
  computed,
  Directive,
  effect,
  HostBinding,
  inject,
  input,
  PLATFORM_ID,
} from '@angular/core';
import {
  hexFromArgb,
  themeFromSourceColor,
} from '@material/material-color-utilities';

@Directive({
  selector: '[appMaterialTheme]',
})
export class MaterialThemeDirective {
  baseColor = input<number>();

  private readonly overlayContainer = inject(OverlayContainer);
  private readonly platformId = inject(PLATFORM_ID);

  constructor() {
    effect((onCleanup) => {
      const styles = this.themeStyles();
      if (
        !isPlatformBrowser(this.platformId) ||
        Object.keys(styles).length === 0
      ) {
        return;
      }

      // Material overlays live outside the themed page's DOM subtree.
      const overlayStyle = this.overlayContainer.getContainerElement().style;
      const previousStyles = Object.keys(styles).map((property) => ({
        priority: overlayStyle.getPropertyPriority(property),
        property,
        value: overlayStyle.getPropertyValue(property),
      }));
      for (const [property, value] of Object.entries(styles)) {
        overlayStyle.setProperty(property, value);
      }
      onCleanup(() => {
        for (const { priority, property, value } of previousStyles) {
          if (value) {
            overlayStyle.setProperty(property, value, priority);
          } else {
            overlayStyle.removeProperty(property);
          }
        }
      });
    });
  }

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
