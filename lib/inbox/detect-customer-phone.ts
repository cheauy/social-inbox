import { findPhoneNumbersInText } from "libphonenumber-js/max";

/** Return one unambiguous, valid phone number, normalized to international form. */
export function detectCustomerPhone(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const text = value.slice(0, 20000).normalize("NFKC")
    .replace(/[០-៩]/g, digit => String(digit.charCodeAt(0) - 0x17e0))
    .replace(/https?:\/\/\S+|www\.\S+|\S+@\S+/gi, match => " ".repeat(match.length));
  const phones = new Set<string>();
  for (const match of findPhoneNumbersInText(text, "KH")) {
    const before = text.slice(Math.max(0, match.startsAt - 45), match.startsAt);
    const after = text.slice(match.endsAt);
    if (/[A-Za-z0-9]$/.test(before) || /^[A-Za-z0-9]/.test(after)) continue;
    if (/(?:order|invoice|tracking|receipt|ref(?:erence)?|id|otp|code|លេខកូដ|លេខបញ្ជាទិញ)\s*(?:no\.?|number)?\s*[:#=-]?\s*$/i.test(before)) continue;
    if (/[$€£៛]\s*$|(?:price|total|amount|តម្លៃ)\s*[:=]?\s*$/i.test(before)) continue;
    if (match.number.isValid()) phones.add(match.number.number);
  }
  return phones.size === 1 ? [...phones][0] : null;
}
