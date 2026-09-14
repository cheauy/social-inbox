import { useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../lib/auth/provider";
import { authCookieName } from "../../lib/supabase/client";
import { sessionCookie } from "../../lib/api/session-cookie";
import { Avatar, Button, IconButton, colors } from "../ui";

type Page = { id: string; name: string; connected: boolean };
export function MessengerConnect({ businessId, onClose, onComplete }: { businessId: string; onClose: () => void; onComplete: (success: boolean, message: string) => void }) {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();
  const browser = useRef<WebView>(null);
  const finished = useRef(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [path, setPath] = useState("/api/mobile/facebook-connect");
  const [pages, setPages] = useState<Page[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const base = new URL(process.env.EXPO_PUBLIC_TENH_API_URL || "https://app.tenhchat.com");
  function retry() { setError(""); setPages(null); setSelected([]); setBusy(false); submitting.current = false; finished.current = false; setPath("/api/mobile/facebook-connect"); setAttempt(value => value + 1); }
  function allow(url: string) {
    if (url === "about:blank") return true;
    let next: URL;
    try { next = new URL(url); } catch { return false; }
    if (next.origin === base.origin) {
      if (next.pathname === "/dashboard/integrations/facebook/select") {
        setPath("/api/mobile/facebook-pages");
        return false;
      }
      if (next.pathname === "/dashboard/integrations" && next.searchParams.has("facebook")) {
        if (!finished.current) {
          finished.current = true;
          onComplete(next.searchParams.get("facebook") === "connected", next.searchParams.get("message") || (next.searchParams.get("facebook") === "connected" ? "Facebook Page connected." : "Connection was not completed. Please try again."));
        }
        return false;
      }
      if (next.pathname === "/login" || next.pathname.startsWith("/dashboard")) {
        setError("Your connection session expired. Sign in to the mobile app again.");
        return false;
      }
      return next.pathname.startsWith("/api/facebook/oauth/") || next.pathname.startsWith("/api/mobile/facebook-");
    }
    return next.protocol === "https:" && (next.hostname === "facebook.com" || next.hostname.endsWith(".facebook.com"));
  }
  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: "white", paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View style={{ flexDirection: "row", alignItems: "center", padding: 12 }}><IconButton icon="chevron-back" label="Back to Integrations" onPress={onClose} /><Text style={{ flex: 1, fontSize: 18, fontWeight: "700", color: colors.ink }}>{pages ? "Select Facebook Pages" : "Connect Messenger"}</Text></View>
      {error ? <View style={{ padding: 20, gap: 16 }}><Text style={{ color: colors.red }}>{error}</Text><Button title="Retry" onPress={retry} /></View> : null}
      {pages && !error ? <>
        <Text style={{ color: colors.muted, paddingHorizontal: 20, paddingBottom: 12 }}>Choose the Pages you want to connect to this workspace.</Text>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
          {!pages.length ? <Text style={{ color: colors.muted }}>No Pages were authorized. Go back and grant access to your Facebook Pages.</Text> : null}
          {pages.map(page => <Pressable key={page.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(page.id), disabled: page.connected || busy }} disabled={page.connected || busy} onPress={() => setSelected(ids => ids.includes(page.id) ? ids.filter(id => id !== page.id) : [...ids, page.id])} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 14, backgroundColor: selected.includes(page.id) ? colors.pale : colors.background }}>
            <Avatar name={page.name} uri={`https://graph.facebook.com/${encodeURIComponent(page.id)}/picture?type=large&width=96&height=96`} size={48} />
            <View style={{ flex: 1, gap: 4 }}><Text style={{ color: colors.ink, fontWeight: "700" }}>{page.name}</Text><Text style={{ color: page.connected ? "#2FA36B" : colors.muted }}>{page.connected ? "Connected" : "Not connected"}</Text></View>
            <Text style={{ color: colors.blue }}>{page.connected || selected.includes(page.id) ? "✓" : "○"}</Text>
          </Pressable>)}
        </ScrollView>
        <View style={{ padding: 16 }}><Button title="Connect" busy={busy} disabled={!selected.length || busy} onPress={() => {
          if (submitting.current || !selected.length) return;
          submitting.current = true; setBusy(true);
          browser.current?.injectJavaScript(`window.connectSelectedPages(${JSON.stringify(selected)}); true;`);
        }} /></View>
      </> : null}
      {session ? <View style={pages || error ? { position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" } : { flex: 1 }} pointerEvents={pages || error ? "none" : "auto"}>
        <WebView key={attempt} ref={browser} source={{ uri: new URL(path, base).toString(), ...(path === "/api/mobile/facebook-connect" ? { headers: { Cookie: sessionCookie(authCookieName, session, businessId) } } : {}) }}
          style={{ flex: 1 }} incognito sharedCookiesEnabled={false} thirdPartyCookiesEnabled setSupportMultipleWindows={false} mixedContentMode="never" originWhitelist={["*"]}
          onShouldStartLoadWithRequest={request => allow(request.url)} onNavigationStateChange={state => { allow(state.url); }}
          onMessage={event => {
            if (event.nativeEvent.url !== new URL("/api/mobile/facebook-pages", base).toString()) return;
            try {
              const payload = JSON.parse(event.nativeEvent.data);
              if (payload.type === "error") { setError(String(payload.message)); return; }
              if (payload.type !== "pages" || !Array.isArray(payload.pages)) return;
              const valid = payload.pages.slice(0, 100).filter((page: Page) => typeof page.id === "string" && /^\d+$/.test(page.id) && typeof page.name === "string" && typeof page.connected === "boolean");
              setPages(valid);
            } catch { setError("Unable to read Facebook Pages. Please retry."); }
          }}
          onError={() => { setError("Unable to complete Facebook connection. Check your connection and retry."); setBusy(false); }}
          onHttpError={event => {
            let failed: URL; try { failed = new URL(event.nativeEvent.url); } catch { return; }
            if (failed.origin === base.origin && failed.pathname.startsWith("/api/mobile/facebook-")) {
              setError(event.nativeEvent.statusCode === 404 ? "The mobile Facebook connection service is not deployed on this server yet. Please update the server before retrying." : "Unable to start Facebook connection. Check your session and channel permissions.");
            }
          }}
          startInLoadingState renderLoading={() => <ActivityIndicator color={colors.blue} style={{ position: "absolute", top: "50%", alignSelf: "center" }} />}
        />
      </View> : <Text style={{ padding: 20 }}>Please sign in to the app again.</Text>}
    </View>
  </Modal>;
}
