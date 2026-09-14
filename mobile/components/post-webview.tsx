import { useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "./ui";

export function PostWebView({ url, onClose }: { url: string; onClose: () => void }) {
  let hostname = "Link";
  try { hostname = new URL(url).hostname; } catch { /* Keep the error screen renderable for a bad saved URL. */ }
  const insets = useSafeAreaInsets();
  const browser = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [error, setError] = useState(false);
  const back = () => canGoBack ? browser.current?.goBack() : onClose();
  return <Modal visible animationType="slide" onRequestClose={back}>
    <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: "white" }}>
      <View style={{ flexDirection: "row", alignItems: "center", padding: 8, borderBottomWidth: 1, borderColor: colors.border }}>
        <Pressable accessibilityLabel="Back" onPress={back} style={{ padding: 12 }}><Ionicons name="chevron-back" size={24} color={colors.blue} /></Pressable>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 17, fontWeight: "600", color: colors.ink }}>{hostname}</Text>
        <Pressable accessibilityLabel="Close link" onPress={onClose} style={{ padding: 12 }}><Ionicons name="close" size={24} color={colors.ink} /></Pressable>
      </View>
      {error ? <Pressable onPress={() => { setError(false); browser.current?.reload(); }} style={{ padding: 16 }}><Text style={{ color: colors.blue }}>Unable to load link. Tap to retry.</Text></Pressable> : null}
      <WebView ref={browser} source={{ uri: url }} style={{ flex: 1 }} startInLoadingState
        renderLoading={() => <ActivityIndicator color={colors.blue} style={{ position: "absolute", alignSelf: "center", top: "50%" }} />}
        onNavigationStateChange={state => setCanGoBack(state.canGoBack)} onError={() => setError(true)}
        // Intercept every scheme so Facebook app links never open another app.
        originWhitelist={["*"]} onShouldStartLoadWithRequest={request => /^https?:\/\//i.test(request.url) || request.url === "about:blank"}
        setSupportMultipleWindows={false} sharedCookiesEnabled={false} mixedContentMode="never" />
    </View>
  </Modal>;
}
