import { useEffect, useState } from "react";
import { Alert, DeviceEventEmitter } from "react-native";
import { PostWebView } from "./post-webview";

const OPEN_LINK = "tenh:open-content-link";
/** Content links stay in Tenh. OAuth continues to use its dedicated auth flow. */
export async function openInAppLink(value: string): Promise<void> {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
    DeviceEventEmitter.emit(OPEN_LINK, url.toString());
  } catch {
    Alert.alert("Unable to open link", "This link cannot be displayed inside Tenh Chat.");
  }
}

export function InAppBrowserHost() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const listener = DeviceEventEmitter.addListener(OPEN_LINK, setUrl);
    return () => listener.remove();
  }, []);
  return url ? <PostWebView key={url} url={url} onClose={() => setUrl(null)} /> : null;
}
