/**
 * Utility to clean transcribed text from AI OCR output:
 * - Eliminates HTML tags like <sup>, </sup>, <u>, </u>, <sub>, </sub>, <br>, etc.
 * - Converts superscript verse numbers like "Isa 51<sup>1-2</sup>, 44<sup>3</sup>" into natural "Isa 51:1-2, 44:3"
 * - Converts LaTeX math artifacts like "$^{1-2}$" into natural ":1-2"
 * - Removes underline tags like "<u>d</u>" into plain "d"
 * - Decodes HTML entities and normalizes whitespace
 */

export function cleanTranscribedText(raw: string): string {
  if (!raw) return "";

  let text = raw;

  // 1. Normalize line endings
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 2. Convert Biblical/Note chapter-verse superscript patterns:
  // e.g. "Isa 51<sup>1-2</sup>" -> "Isa 51:1-2"
  // e.g. "44<sup>3</sup>" -> "44:3"
  // e.g. "Jer 15<sup>16</sup>" -> "Jer 15:16"
  text = text.replace(/(\b\d+)<sup>\s*([0-9]+(?:-[0-9]+)?)\s*<\/sup>/gi, "$1:$2");
  text = text.replace(/(\b\d+)\s*\$?\^\{?\s*([0-9]+(?:-[0-9]+)?)\s*\}?\$?/g, "$1:$2");

  // 3. Convert general <sup>...</sup> to plain text
  text = text.replace(/<sup>\s*(.*?)\s*<\/sup>/gi, "$1");

  // 4. Convert <sub>...</sub> to plain text
  text = text.replace(/<sub>\s*(.*?)\s*<\/sub>/gi, "$1");

  // 5. Convert <u>...</u> to plain text (e.g. <u>d</u> -> d)
  text = text.replace(/<u>\s*(.*?)\s*<\/u>/gi, "$1");

  // 6. Remove LaTeX math wrappers like $^{...}$ or $...$
  text = text.replace(/\$\^\{?([^\}]+)\}?\$/g, "$1");
  text = text.replace(/\$([^\$\n]+)\$/g, "$1");

  // 7. Remove any other HTML tags (like <mark>, <span>, <font>, <br>, etc.)
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, "");

  // 8. Decode HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // 9. Remove zero-width characters and weird replacement characters
  text = text.replace(/[\u200B-\u200D\uFEFF]/g, "");

  return text.trim();
}
