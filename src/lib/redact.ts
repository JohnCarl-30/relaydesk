/**
 * Strips personal data from text before it leaves the process in a trace.
 * Visitors paste emails, phone numbers, and sometimes card numbers into chat.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// A digit run that may be split by spaces, dashes, dots, or brackets.
// Commas are not separators, so "10,000,000" stays a number.
const DIGIT_RUN = /(?<![\w+])\+?\(?\d[\d\s().-]*\d(?!\w)/g;

const PHONE_MIN_DIGITS = 9;
const CARD_MIN_DIGITS = 14;
const CARD_MAX_DIGITS = 19;

function maskDigitRun(match: string): string {
  const digits = match.replace(/\D/g, "").length;
  if (digits < PHONE_MIN_DIGITS || digits > CARD_MAX_DIGITS) return match;
  return digits >= CARD_MIN_DIGITS ? "[card]" : "[phone]";
}

export function redactText(text: string): string {
  return text.replace(EMAIL, "[email]").replace(DIGIT_RUN, maskDigitRun);
}
