import { OCR_LANGUAGES } from "../../../components/PdfViewer/ocr.ts";

export interface TranslationLanguage {
  /** Stable id (language tag). */
  value: string;
  label: string;
}

/** Source-language value that tells the model to detect the language itself. */
export const AUTO_LANGUAGE = "auto";

/** Languages the AI can translate from/to (human-readable names are sent to
 *  the model; the codes are only used to remember the user's choice). */
export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { value: "en", label: "English" },
  { value: "fa", label: "Persian" },
  { value: "ar", label: "Arabic" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "ru", label: "Russian" },
  { value: "zh", label: "Chinese (Simplified)" },
  { value: "zh-Hant", label: "Chinese (Traditional)" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "hi", label: "Hindi" },
  { value: "ur", label: "Urdu" },
  { value: "tr", label: "Turkish" },
  { value: "nl", label: "Dutch" },
  { value: "pl", label: "Polish" },
  { value: "sv", label: "Swedish" },
  { value: "da", label: "Danish" },
  { value: "no", label: "Norwegian" },
  { value: "fi", label: "Finnish" },
  { value: "cs", label: "Czech" },
  { value: "el", label: "Greek" },
  { value: "he", label: "Hebrew" },
  { value: "ro", label: "Romanian" },
  { value: "hu", label: "Hungarian" },
  { value: "uk", label: "Ukrainian" },
  { value: "th", label: "Thai" },
  { value: "vi", label: "Vietnamese" },
  { value: "id", label: "Indonesian" },
  { value: "ms", label: "Malay" },
  { value: "bn", label: "Bengali" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "mr", label: "Marathi" },
  { value: "gu", label: "Gujarati" },
  { value: "kn", label: "Kannada" },
  { value: "ml", label: "Malayalam" },
  { value: "si", label: "Sinhala" },
  { value: "ne", label: "Nepali" },
  { value: "pa", label: "Punjabi" },
  { value: "az", label: "Azerbaijani" },
  { value: "kk", label: "Kazakh" },
  { value: "uz", label: "Uzbek" },
  { value: "ky", label: "Kyrgyz" },
  { value: "tg", label: "Tajik" },
  { value: "ps", label: "Pashto" },
  { value: "ku", label: "Kurdish" },
  { value: "sr", label: "Serbian" },
  { value: "hr", label: "Croatian" },
  { value: "bg", label: "Bulgarian" },
  { value: "sk", label: "Slovak" },
  { value: "sl", label: "Slovenian" },
  { value: "lt", label: "Lithuanian" },
  { value: "lv", label: "Latvian" },
  { value: "et", label: "Estonian" },
  { value: "is", label: "Icelandic" },
  { value: "ga", label: "Irish" },
  { value: "cy", label: "Welsh" },
  { value: "mt", label: "Maltese" },
  { value: "sq", label: "Albanian" },
  { value: "mk", label: "Macedonian" },
  { value: "hy", label: "Armenian" },
  { value: "ka", label: "Georgian" },
  { value: "am", label: "Amharic" },
  { value: "sw", label: "Swahili" },
  { value: "af", label: "Afrikaans" },
  { value: "my", label: "Burmese" },
  { value: "km", label: "Khmer" },
  { value: "lo", label: "Lao" },
  { value: "mn", label: "Mongolian" },
  { value: "bo", label: "Tibetan" },
  { value: "sd", label: "Sindhi" },
  { value: "tl", label: "Filipino" },
  { value: "eo", label: "Esperanto" },
  { value: "la", label: "Latin" },
].sort((a, b) => a.label.localeCompare(b.label));

/** Human-readable name for an AI language code. */
export function languageLabel(code: string): string {
  return TRANSLATION_LANGUAGES.find((lang) => lang.value === code)?.label ?? code;
}

/** Human-readable names for tesseract OCR codes (multi-language pages). */
export function ocrLanguagesLabel(codes: string[]): string {
  const labels = codes.map(
    (code) => OCR_LANGUAGES.find((lang) => lang.code === code)?.label ?? code,
  );
  return labels.join(", ");
}