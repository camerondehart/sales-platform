/**
 * What this device calls its built-in unlock, for the passkey buttons:
 * Face ID on iPhone/iPad, Touch ID on a Mac, fingerprint on Android,
 * Windows Hello on Windows. (Passkeys use whichever the device has — an
 * iPhone with a home button uses Touch ID, an Android phone may use face
 * unlock — the label is just the likeliest name.) Browser-only.
 */
export function unlockName(ua: string = typeof navigator !== "undefined" ? navigator.userAgent : ""): string {
  // iPadOS reports itself as a Mac; touch support gives it away.
  const touchMac = /Macintosh/i.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/i.test(ua) || touchMac) return "Face ID";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Touch ID";
  if (/Android/i.test(ua)) return "fingerprint";
  if (/Windows/i.test(ua)) return "Windows Hello";
  return "a passkey";
}
