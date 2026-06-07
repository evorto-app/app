import { expect, type Page } from '@playwright/test';

export type OverflowingElementLabel = {
  className: string;
  right: number;
  tagName: string;
  text: string;
  width: number;
};

export type CoveredControlLabel = {
  centerX: number;
  centerY: number;
  className: string;
  coveringClassName: string;
  coveringTagName: string;
  coveringText: string;
  tagName: string;
  text: string;
};

export type ClippedControlLabel = {
  className: string;
  left: number;
  right: number;
  tagName: string;
  text: string;
  width: number;
};

export type ClippedTextLabel = {
  className: string;
  left: number;
  right: number;
  tagName: string;
  text: string;
  width: number;
};

export type VerticallyClippedControlLabel = {
  bottom: number;
  className: string;
  height: number;
  position: string;
  tagName: string;
  text: string;
  top: number;
};

export type VerticallyClippedTextLabel = {
  bottom: number;
  className: string;
  height: number;
  position: string;
  tagName: string;
  text: string;
  top: number;
};

export type LoadingTextLabel = {
  className: string;
  tagName: string;
  text: string;
};

export type CoveredTextLabel = {
  centerX: number;
  centerY: number;
  className: string;
  coveringClassName: string;
  coveringTagName: string;
  coveringText: string;
  tagName: string;
  text: string;
};

export type UnlabeledControlLabel = {
  className: string;
  tagName: string;
};

export type PageLayout = {
  appError: boolean;
  coveredControlCount: number;
  coveredControlLabels: CoveredControlLabel[];
  coveredTextCount: number;
  coveredTextLabels: CoveredTextLabel[];
  horizontalOverflow: boolean;
  horizontallyClippedControlCount: number;
  horizontallyClippedControlLabels: ClippedControlLabel[];
  horizontallyClippedTextCount: number;
  horizontallyClippedTextLabels: ClippedTextLabel[];
  horizontallyOverflowingElementCount: number;
  horizontallyOverflowingElementLabels: OverflowingElementLabel[];
  unlabeledControlCount: number;
  unlabeledControlLabels: UnlabeledControlLabel[];
  visibleLoadingTextCount: number;
  visibleLoadingTextLabels: LoadingTextLabel[];
  verticallyClippedFixedControlCount: number;
  verticallyClippedFixedControlLabels: VerticallyClippedControlLabel[];
  verticallyClippedFixedTextCount: number;
  verticallyClippedFixedTextLabels: VerticallyClippedTextLabel[];
};

export const expectedStablePageLayout = {
  appError: false,
  coveredControlCount: 0,
  coveredControlLabels: [],
  coveredTextCount: 0,
  coveredTextLabels: [],
  horizontalOverflow: false,
  horizontallyClippedControlCount: 0,
  horizontallyClippedControlLabels: [],
  horizontallyClippedTextCount: 0,
  horizontallyClippedTextLabels: [],
  horizontallyOverflowingElementCount: 0,
  horizontallyOverflowingElementLabels: [],
  unlabeledControlCount: 0,
  unlabeledControlLabels: [],
  visibleLoadingTextCount: 0,
  visibleLoadingTextLabels: [],
  verticallyClippedFixedControlCount: 0,
  verticallyClippedFixedControlLabels: [],
  verticallyClippedFixedTextCount: 0,
  verticallyClippedFixedTextLabels: [],
} satisfies PageLayout;

const blockedConsoleTypes = new Set(['error', 'warning']);

export const collectBrowserLogFailures = (page: Page): string[] => {
  const browserLogFailures: string[] = [];

  page.on('console', (message) => {
    if (!blockedConsoleTypes.has(message.type())) {
      return;
    }

    const location = message.location();
    const source = location.url
      ? `${location.url}:${location.lineNumber}:${location.columnNumber}`
      : page.url();
    browserLogFailures.push(`${message.type()}: ${message.text()} (${source})`);
  });

  return browserLogFailures;
};

export const readPageLayout = async (page: Page): Promise<PageLayout> =>
  page.evaluate(() => {
    const isInsideHorizontalScrollContainer = (element: HTMLElement) => {
      let current: HTMLElement | null = element.parentElement;

      while (current) {
        const style = window.getComputedStyle(current);
        const hasHorizontalScroll =
          current.scrollWidth > current.clientWidth + 1 &&
          ['auto', 'scroll'].includes(style.overflowX);

        if (hasHorizontalScroll) {
          return true;
        }

        current = current.parentElement;
      }

      return false;
    };
    const isElementCenterInsideOverflowClip = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      let current: HTMLElement | null = element.parentElement;

      while (current) {
        const style = window.getComputedStyle(current);
        const clipsHorizontal = ['auto', 'clip', 'hidden', 'scroll'].includes(
          style.overflowX,
        );
        const clipsVertical = ['auto', 'clip', 'hidden', 'scroll'].includes(
          style.overflowY,
        );

        if (clipsHorizontal || clipsVertical) {
          const clipRect = current.getBoundingClientRect();

          if (
            (clipsHorizontal &&
              (centerX < clipRect.left || centerX > clipRect.right)) ||
            (clipsVertical &&
              (centerY < clipRect.top || centerY > clipRect.bottom))
          ) {
            return false;
          }
        }

        current = current.parentElement;
      }

      return true;
    };
    const fixedOrStickyPosition = (element: HTMLElement): string => {
      let current: HTMLElement | null = element;

      while (current) {
        const position = window.getComputedStyle(current).position;
        if (position === 'fixed' || position === 'sticky') {
          return position;
        }

        current = current.parentElement;
      }

      return '';
    };
    const elementLabel = (element: HTMLElement): string => {
      const labelledBy = element
        .getAttribute('aria-labelledby')
        ?.split(/\s+/u)
        .map((id) => document.getElementById(id)?.innerText ?? '')
        .join(' ');
      const associatedLabel =
        element.id.trim().length > 0
          ? (document.querySelector(`label[for="${CSS.escape(element.id)}"]`)
              ?.textContent ?? '')
          : '';
      const valueLabel =
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement
          ? element.value || element.placeholder
          : '';
      const label = [
        element.getAttribute('aria-label') ?? undefined,
        labelledBy,
        element.getAttribute('title') ?? undefined,
        associatedLabel,
        element.innerText,
        valueLabel,
      ]
        .filter(
          (candidate): candidate is string => typeof candidate === 'string',
        )
        .find((candidate) => candidate.trim().length > 0);

      return label?.trim().replace(/\s+/g, ' ').slice(0, 80) ?? '';
    };
    const directText = (element: HTMLElement): string =>
      [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join(' ')
        .trim()
        .replace(/\s+/g, ' ');
    const interactiveSelector = [
      'a[href]',
      'button',
      'input',
      'select',
      'textarea',
      '[contenteditable="true"]',
      '[tabindex]:not([tabindex="-1"])',
      '[role="button"]',
      '[role="checkbox"]',
      '[role="combobox"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[role="radio"]',
      '[role="slider"]',
      '[role="spinbutton"]',
      '[role="switch"]',
      '[role="tab"]',
    ].join(', ');
    const visibleElements = [...document.querySelectorAll<HTMLElement>('*')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
          !element.classList.contains('mat-mdc-button-touch-target') &&
          !isInsideHorizontalScrollContainer(element) &&
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.display !== 'none'
        );
      })
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
      }));
    const controls = [
      ...document.querySelectorAll<HTMLElement>(interactiveSelector),
    ].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);

      return (
        !element.classList.contains('mat-mdc-button-touch-target') &&
        !isInsideHorizontalScrollContainer(element) &&
        rect.width > 0 &&
        rect.height > 0 &&
        isElementCenterInsideOverflowClip(element) &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      );
    });
    const controlElements = new Set(controls);
    const readableTextElements = [
      ...document.querySelectorAll<HTMLElement>(
        'h1, h2, h3, h4, h5, h6, p, dt, dd, li, figcaption, summary, label, [data-layout-readable-text]',
      ),
    ].filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const hasReadableText =
        element.innerText?.trim().replace(/\s+/g, ' ').length > 0;

      return (
        hasReadableText &&
        !controlElements.has(element) &&
        !element.closest(interactiveSelector) &&
        !isInsideHorizontalScrollContainer(element) &&
        rect.width > 0 &&
        rect.height > 0 &&
        isElementCenterInsideOverflowClip(element) &&
        style.visibility !== 'hidden' &&
        style.display !== 'none'
      );
    });
    const horizontallyClippedControls = controls.filter((element) => {
      const rect = element.getBoundingClientRect();

      return rect.left < -1 || rect.right > window.innerWidth + 1;
    });
    const horizontallyClippedControlLabels = horizontallyClippedControls.map(
      (element) => {
        const rect = element.getBoundingClientRect();

        return {
          className: element.className.toString(),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          tagName: element.tagName.toLowerCase(),
          text: elementLabel(element),
          width: Math.round(rect.width),
        };
      },
    );
    const unlabeledControls = controls.filter(
      (element) => elementLabel(element).length === 0,
    );
    const unlabeledControlLabels = unlabeledControls.map((element) => ({
      className: element.className.toString(),
      tagName: element.tagName.toLowerCase(),
    }));
    const horizontallyClippedTextElements = readableTextElements.filter(
      (element) => {
        const rect = element.getBoundingClientRect();

        return rect.left < -1 || rect.right > window.innerWidth + 1;
      },
    );
    const horizontallyClippedTextLabels = horizontallyClippedTextElements.map(
      (element) => {
        const rect = element.getBoundingClientRect();

        return {
          className: element.className.toString(),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          tagName: element.tagName.toLowerCase(),
          text:
            element.innerText?.trim().replace(/\s+/g, ' ').slice(0, 80) ?? '',
          width: Math.round(rect.width),
        };
      },
    );
    const verticallyClippedFixedControls = controls.filter((element) => {
      if (!fixedOrStickyPosition(element)) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      const partiallyVisible =
        rect.bottom > 1 && rect.top < window.innerHeight - 1;

      return (
        partiallyVisible &&
        (rect.top < -1 || rect.bottom > window.innerHeight + 1)
      );
    });
    const verticallyClippedFixedControlLabels =
      verticallyClippedFixedControls.map((element) => {
        const rect = element.getBoundingClientRect();

        return {
          bottom: Math.round(rect.bottom),
          className: element.className.toString(),
          height: Math.round(rect.height),
          position: fixedOrStickyPosition(element),
          tagName: element.tagName.toLowerCase(),
          text: elementLabel(element),
          top: Math.round(rect.top),
        };
      });
    const verticallyClippedFixedTextElements = readableTextElements.filter(
      (element) => {
        if (!fixedOrStickyPosition(element)) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        const partiallyVisible =
          rect.bottom > 1 && rect.top < window.innerHeight - 1;

        return (
          partiallyVisible &&
          (rect.top < -1 || rect.bottom > window.innerHeight + 1)
        );
      },
    );
    const verticallyClippedFixedTextLabels =
      verticallyClippedFixedTextElements.map((element) => {
        const rect = element.getBoundingClientRect();

        return {
          bottom: Math.round(rect.bottom),
          className: element.className.toString(),
          height: Math.round(rect.height),
          position: fixedOrStickyPosition(element),
          tagName: element.tagName.toLowerCase(),
          text:
            element.innerText?.trim().replace(/\s+/g, ' ').slice(0, 80) ?? '',
          top: Math.round(rect.top),
        };
      });
    const isSameMaterialFormFieldDecoration = (
      control: HTMLElement,
      hitTarget: HTMLElement,
    ): boolean => {
      const controlFormField = control.closest('.mat-mdc-form-field');

      if (!controlFormField?.contains(hitTarget)) {
        return false;
      }

      return (
        hitTarget.tagName.toLowerCase() === 'mat-label' ||
        hitTarget.classList.contains('mdc-floating-label') ||
        hitTarget.classList.contains('mat-mdc-form-field-required-marker') ||
        hitTarget.closest('.mdc-floating-label') !== null
      );
    };
    const isSameMaterialPaginatorTouchTarget = (
      control: HTMLElement,
      hitTarget: HTMLElement,
    ): boolean => {
      const paginator = control.closest('.mat-mdc-paginator');

      return (
        paginator instanceof HTMLElement &&
        paginator.contains(hitTarget) &&
        hitTarget.classList.contains('mat-mdc-paginator-touch-target')
      );
    };
    const isSameInteractiveSurface = (
      control: HTMLElement,
      hitTarget: HTMLElement,
    ): boolean => {
      const hitInteractiveSurface = hitTarget.closest(interactiveSelector);

      return hitInteractiveSurface === control;
    };
    const hasVerticalScrollRemaining = (element: HTMLElement): boolean => {
      let current: HTMLElement | null = element.parentElement;

      while (current) {
        const style = window.getComputedStyle(current);
        const hasVerticalScroll =
          current.scrollHeight > current.clientHeight + 1 &&
          ['auto', 'scroll'].includes(style.overflowY) &&
          current.scrollTop + current.clientHeight < current.scrollHeight - 1;

        if (hasVerticalScroll) {
          return true;
        }

        current = current.parentElement;
      }

      return (
        document.documentElement.scrollTop + window.innerHeight <
        document.documentElement.scrollHeight - 1
      );
    };
    const isRecoverableMobileNavigationOverlap = (
      control: HTMLElement,
      hitTarget: HTMLElement,
      centerY: number,
    ): boolean => {
      const navigation = hitTarget.closest('.navigation');

      return (
        navigation instanceof HTMLElement &&
        centerY >= navigation.getBoundingClientRect().top &&
        hasVerticalScrollRemaining(control)
      );
    };
    const coveredControls = controls.filter((element) => {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      if (
        centerX < 0 ||
        centerX > window.innerWidth ||
        centerY < 0 ||
        centerY > window.innerHeight
      ) {
        return false;
      }

      const elementAtCenter = document.elementFromPoint(centerX, centerY);

      return (
        elementAtCenter instanceof HTMLElement &&
        !element.contains(elementAtCenter) &&
        !elementAtCenter.contains(element) &&
        !isSameInteractiveSurface(element, elementAtCenter) &&
        !isSameMaterialFormFieldDecoration(element, elementAtCenter) &&
        !isSameMaterialPaginatorTouchTarget(element, elementAtCenter) &&
        !isRecoverableMobileNavigationOverlap(element, elementAtCenter, centerY)
      );
    });
    const coveredControlLabels = coveredControls.map((element) => {
      const rect = element.getBoundingClientRect();
      const elementAtCenter = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );

      return {
        centerX: Math.round(rect.left + rect.width / 2),
        centerY: Math.round(rect.top + rect.height / 2),
        className: element.className.toString(),
        coveringClassName:
          elementAtCenter instanceof HTMLElement
            ? elementAtCenter.className.toString()
            : '',
        coveringTagName:
          elementAtCenter instanceof HTMLElement
            ? elementAtCenter.tagName.toLowerCase()
            : '',
        coveringText:
          elementAtCenter instanceof HTMLElement
            ? elementLabel(elementAtCenter)
            : '',
        tagName: element.tagName.toLowerCase(),
        text: elementLabel(element),
      };
    });
    const coveredTextElements = readableTextElements.filter((element) => {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      if (
        centerX < 0 ||
        centerX > window.innerWidth ||
        centerY < 0 ||
        centerY > window.innerHeight
      ) {
        return false;
      }

      const elementAtCenter = document.elementFromPoint(centerX, centerY);

      return (
        elementAtCenter instanceof HTMLElement &&
        !element.contains(elementAtCenter) &&
        !elementAtCenter.contains(element) &&
        !isRecoverableMobileNavigationOverlap(element, elementAtCenter, centerY)
      );
    });
    const coveredTextLabels = coveredTextElements.map((element) => {
      const rect = element.getBoundingClientRect();
      const elementAtCenter = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );

      return {
        centerX: Math.round(rect.left + rect.width / 2),
        centerY: Math.round(rect.top + rect.height / 2),
        className: element.className.toString(),
        coveringClassName:
          elementAtCenter instanceof HTMLElement
            ? elementAtCenter.className.toString()
            : '',
        coveringTagName:
          elementAtCenter instanceof HTMLElement
            ? elementAtCenter.tagName.toLowerCase()
            : '',
        coveringText:
          elementAtCenter instanceof HTMLElement
            ? (elementAtCenter.innerText
                ?.trim()
                .replace(/\s+/g, ' ')
                .slice(0, 80) ?? '')
            : '',
        tagName: element.tagName.toLowerCase(),
        text: element.innerText?.trim().replace(/\s+/g, ' ').slice(0, 80) ?? '',
      };
    });
    const horizontallyOverflowingElements = visibleElements.filter(
      ({ rect }) => rect.left < -1 || rect.right > window.innerWidth + 1,
    );
    const horizontallyOverflowingElementLabels =
      horizontallyOverflowingElements.map(({ element, rect }) => ({
        className: element.className.toString(),
        right: Math.round(rect.right),
        tagName: element.tagName.toLowerCase(),
        text: element.innerText?.trim().replace(/\s+/g, ' ').slice(0, 80) ?? '',
        width: Math.round(rect.width),
      }));
    const visibleLoadingTextElements = visibleElements
      .map(({ element }) => element)
      .filter((element) => /^Loading\b.*$/u.test(directText(element)));
    const visibleLoadingTextLabels = visibleLoadingTextElements.map(
      (element) => ({
        className: element.className.toString(),
        tagName: element.tagName.toLowerCase(),
        text: directText(element).slice(0, 80),
      }),
    );

    return {
      appError: /application error|server error|hydration/i.test(
        document.body.innerText,
      ),
      coveredControlCount: coveredControls.length,
      coveredControlLabels,
      coveredTextCount: coveredTextElements.length,
      coveredTextLabels,
      horizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth + 1 &&
        horizontallyOverflowingElements.length > 0,
      horizontallyClippedControlCount: horizontallyClippedControls.length,
      horizontallyClippedControlLabels,
      horizontallyClippedTextCount: horizontallyClippedTextElements.length,
      horizontallyClippedTextLabels,
      horizontallyOverflowingElementCount:
        horizontallyOverflowingElements.length,
      horizontallyOverflowingElementLabels,
      unlabeledControlCount: unlabeledControls.length,
      unlabeledControlLabels,
      visibleLoadingTextCount: visibleLoadingTextElements.length,
      visibleLoadingTextLabels,
      verticallyClippedFixedControlCount: verticallyClippedFixedControls.length,
      verticallyClippedFixedControlLabels,
      verticallyClippedFixedTextCount:
        verticallyClippedFixedTextElements.length,
      verticallyClippedFixedTextLabels,
    };
  });

export const expectStablePageLayout = async (page: Page) => {
  await expect
    .poll(() => readPageLayout(page), {
      message:
        'page layout should settle without visible loading text or glitches',
      timeout: 15_000,
    })
    .toEqual(expectedStablePageLayout);
};
