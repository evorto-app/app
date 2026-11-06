export const isWebUrl = (value: string): boolean => {
  if (
    value !== value.trim() ||
    value.length > 2048 ||
    !/^https?:\/\//i.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
};
