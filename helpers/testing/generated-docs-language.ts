export const generatedGuideImplementationTerms =
  /\b(?:apis?|authentication|authorized|browser|conditional|configur(?:ation|e[ds]?|ing)|databases?|domains?|eligibility|eligible|endpoints?|exports?|fallbacks?|https?|metadata|participants?|payloads?|prerequisites?|providers?|reassign(?:ed|ing|ment|s)?|refresh(?:ed|es|ing)?|register(?:ed|ing|s)?|registrations?|relaunch|rpcs?|schemas?|settlements?|stripe|tenants?|transactions?|urls?|webhooks?|workflows?)\b|\b(?:accurate|existing|reliable)\s+records?\b|\bfrom this record\b|access denial|audit log|checkout sessions?|\bcross-organization\b|event editors?|internal id|listing audience|local walkthrough|operator reason|platform administrator|queued for refund|reload the|reload this|request failure|source of truth|standard member access|visibility setting/giu;

const fencedCodeMarker = /^ {0,3}(?<marks>`{3,}|~{3,})(?<tail>.*)$/u;

const markdownLinesOutsideFencedCode = (markdown: string): string[] => {
  let activeFence: { marker: '`' | '~'; width: number } | undefined;
  const visibleLines: string[] = [];

  for (const line of markdown.split('\n')) {
    const match = fencedCodeMarker.exec(line);
    const marks = match?.groups?.['marks'];
    if (marks) {
      const marker = marks[0];
      if (marker !== '`' && marker !== '~') continue;
      if (!activeFence) {
        activeFence = { marker, width: marks.length };
      } else if (
        marker === activeFence.marker &&
        marks.length >= activeFence.width &&
        !match.groups?.['tail']?.trim()
      ) {
        activeFence = undefined;
      }
      visibleLines.push('');
      continue;
    }
    visibleLines.push(activeFence ? '' : line);
  }

  return visibleLines;
};

export const generatedGuideLevelOneHeadingViolations = (
  markdown: string,
): string[] => {
  const lines = markdownLinesOutsideFencedCode(markdown);
  return lines.flatMap((line, index) => {
    const violations: string[] = [];
    if (/^ {0,3}#(?:[\t ]+|$)/u.test(line)) violations.push(line.trim());
    if (/<h1(?:[\s>])/iu.test(line)) violations.push(line.trim());
    if (
      /^ {0,3}=+[\t ]*$/u.test(line) &&
      (lines[index - 1]?.trim().length ?? 0) > 0
    ) {
      violations.push(`${lines[index - 1]?.trim()}\n${line.trim()}`);
    }
    return violations;
  });
};

export const generatedGuideVisibleText = (markdown: string): string =>
  markdown
    .replaceAll(
      /\{%\s*figure\b[^%]*?\bcaption=(?:"(?<double>[^"]*)"|'(?<single>[^']*)')[^%]*%\}/giu,
      (_match, ...arguments_: unknown[]) => {
        const groups = arguments_.at(-1) as
          { double?: string; single?: string } | undefined;
        return groups?.double ?? groups?.single ?? '';
      },
    )
    .replaceAll(/!\[(?<alt>[^\]]*)\]\([^)]+\)/gu, '$<alt>')
    .replaceAll(/\[(?<label>[^\]]+)\]\([^)]+\)/gu, '$<label>')
    .replaceAll(/https?:\/\/\S+/giu, ' ')
    .replaceAll(/<[^>]+>/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();

export const generatedGuideLanguageViolations = (markdown: string): string[] =>
  [
    ...generatedGuideVisibleText(markdown).matchAll(
      generatedGuideImplementationTerms,
    ),
  ].map((match) => match[0]);
