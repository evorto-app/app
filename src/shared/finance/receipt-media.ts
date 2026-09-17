export const allowedReceiptMimeTypes = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const maximumReceiptOriginalSizeBytes = 20 * 1024 * 1024;

export const receiptFileAccept = allowedReceiptMimeTypes.join(',');

const allowedReceiptMimeTypeSet = new Set<string>(allowedReceiptMimeTypes);

export const isAllowedReceiptMimeType = (mimeType: string): boolean =>
  allowedReceiptMimeTypeSet.has(mimeType);

export const validateReceiptFileMetadata = (input: {
  mimeType: string;
  sizeBytes: number;
}): null | string => {
  if (!isAllowedReceiptMimeType(input.mimeType)) {
    return 'This receipt cannot be used. Choose a different receipt image or document.';
  }
  if (
    !Number.isSafeInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > maximumReceiptOriginalSizeBytes
  ) {
    return 'This receipt is empty or larger than 20 MB. Choose another image or document.';
  }
  return null;
};
