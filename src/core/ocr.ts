/**
 * OCR module — extract text from images using Tesseract.js (pure JS, no native deps).
 */
import Tesseract from 'tesseract.js';

export const IMAGE_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/bmp',
];

/**
 * Returns true if the given content-type string is a supported image type.
 */
export function isImageContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return IMAGE_CONTENT_TYPES.some(t => ct.includes(t));
}

/**
 * Extract text from an image buffer using Tesseract OCR.
 * @param imageBuffer - Raw image bytes
 * @param language    - Tesseract language code (default: 'eng')
 * @returns Extracted text, trimmed. Empty string when no text found.
 */
export async function extractTextFromImage(
  imageBuffer: Buffer,
  language: string = 'eng',
): Promise<string> {
  const { data: { text } } = await Tesseract.recognize(imageBuffer, language, {
    // Suppress verbose Tesseract logging
    logger: () => {},
  });
  return text.trim();
}
