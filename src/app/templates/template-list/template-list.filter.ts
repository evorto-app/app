import type { TemplatesByCategoryRecord } from '@shared/rpc-contracts/app-rpcs/templates.rpcs';

export const normalizeTemplateSearch = (search: string): string =>
  search.trim().toLocaleLowerCase();

export const filterTemplateCategories = (
  categories: readonly TemplatesByCategoryRecord[],
  search: string,
): readonly TemplatesByCategoryRecord[] => {
  const normalizedSearch = normalizeTemplateSearch(search);
  if (!normalizedSearch) {
    return categories;
  }

  return categories.flatMap((category) => {
    const templates = category.templates.filter((template) =>
      template.title.toLocaleLowerCase().includes(normalizedSearch),
    );
    return templates.length > 0 ? [{ ...category, templates }] : [];
  });
};
