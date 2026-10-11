import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dashboard/inbox", name: "TENH CHAT", short_name: "TENH CHAT",
    description: "TENH CHAT customer messaging", start_url: "/dashboard/inbox", scope: "/",
    display: "standalone", background_color: "#ffffff", theme_color: "#ffffff",
    icons: [
      { src: "/icons/tenh-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/tenh-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/tenh-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
