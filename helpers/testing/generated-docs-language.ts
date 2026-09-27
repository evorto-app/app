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
