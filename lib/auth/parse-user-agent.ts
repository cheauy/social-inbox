export type DeviceType = "desktop" | "phone" | "tablet" | "unknown";

export type ParsedUserAgent = {
  browser: string;
  operatingSystem: string;
  deviceType: DeviceType;
  label: string;
};

const UNKNOWN: ParsedUserAgent = {
  browser: "Unknown browser",
  operatingSystem: "Unknown device",
  deviceType: "unknown",
  label: "Unknown device",
};

function detectBrowser(ua: string) {
  // Order matters: Edge and Opera both contain "chrome/",
  // and Chrome contains "safari/".
  if (ua.includes("edg/") || ua.includes("edga/") || ua.includes("edgios/")) {
    return "Edge";
  }

  if (ua.includes("opr/") || ua.includes("opera")) {
    return "Opera";
  }

  if (ua.includes("samsungbrowser/")) {
    return "Samsung Internet";
  }

  if (ua.includes("firefox/") || ua.includes("fxios/")) {
    return "Firefox";
  }

  if (ua.includes("crios/")) {
    return "Chrome";
  }

  if (ua.includes("chrome/") || ua.includes("chromium/")) {
    return "Chrome";
  }

  if (ua.includes("safari/")) {
    return "Safari";
  }

  if (ua.includes("okhttp") || ua.includes("dart:io")) {
    return "Mobile app";
  }

  return "Unknown browser";
}

function detectOperatingSystem(ua: string) {
  if (ua.includes("windows nt")) {
    return "Windows";
  }

  if (ua.includes("iphone")) {
    return "iPhone";
  }

  if (ua.includes("ipad")) {
    return "iPad";
  }

  if (ua.includes("android")) {
    return "Android";
  }

  if (ua.includes("mac os x") || ua.includes("macintosh")) {
    return "macOS";
  }

  if (ua.includes("cros")) {
    return "ChromeOS";
  }

  if (ua.includes("linux")) {
    return "Linux";
  }

  return "Unknown device";
}

function detectDeviceType(
  ua: string,
  operatingSystem: string,
): DeviceType {
  if (operatingSystem === "iPad" || ua.includes("tablet")) {
    return "tablet";
  }

  if (
    operatingSystem === "iPhone" ||
    ua.includes("mobile") ||
    (operatingSystem === "Android" && ua.includes("mobi"))
  ) {
    return "phone";
  }

  if (
    operatingSystem === "Windows" ||
    operatingSystem === "macOS" ||
    operatingSystem === "Linux" ||
    operatingSystem === "ChromeOS"
  ) {
    return "desktop";
  }

  if (operatingSystem === "Android") {
    return "phone";
  }

  return "unknown";
}

export function parseUserAgent(
  userAgent: string | null | undefined,
): ParsedUserAgent {
  const raw = userAgent?.trim();

  if (!raw) {
    return UNKNOWN;
  }

  const ua = raw.toLowerCase();

  const browser = detectBrowser(ua);
  const operatingSystem = detectOperatingSystem(ua);
  const deviceType = detectDeviceType(ua, operatingSystem);

  const isUnknownOs = operatingSystem === "Unknown device";
  const isUnknownBrowser = browser === "Unknown browser";

  let label: string;

  if (isUnknownOs && isUnknownBrowser) {
    label = "Unknown device";
  } else if (isUnknownOs) {
    label = browser;
  } else if (isUnknownBrowser) {
    label = operatingSystem;
  } else {
    label = `${operatingSystem} · ${browser}`;
  }

  return {
    browser,
    operatingSystem,
    deviceType,
    label,
  };
}
