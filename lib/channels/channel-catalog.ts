export type TenhChannelPlatform =
  | "facebook"
  | "telegram"
  | "instagram"
  | "whatsapp"
  | "tiktok";

export type TenhChannelAvailability =
  | "available"
  | "next"
  | "coming_soon";

export type TenhChannelDefinition = {
  platform: TenhChannelPlatform;
  name: string;
  shortName: string;
  availability: TenhChannelAvailability;
  statusLabel: string;
  description: string;
  canConnect: boolean;
};

export const TENH_CHANNEL_CATALOG: readonly TenhChannelDefinition[] = [
  {
    platform: "facebook",
    name: "Facebook Messenger",
    shortName: "Messenger",
    availability: "available",
    statusLabel: "Available now",
    description:
      "Connect Facebook Pages and manage Messenger conversations from TENH Chat.",
    canConnect: true,
  },
  {
    platform: "telegram",
    name: "Telegram",
    shortName: "Telegram",
    availability: "next",
    statusLabel: "Connection setup available",
    description:
      "Connect and verify your Telegram Bot now. Telegram Inbox message receiving and replying are enabled in the next TENH step.",
    canConnect: true,
  },
  {
    platform: "instagram",
    name: "Instagram",
    shortName: "Instagram",
    availability: "coming_soon",
    statusLabel: "Coming soon",
    description:
      "Instagram messaging support is planned for a future TENH Chat update.",
    canConnect: false,
  },
  {
    platform: "whatsapp",
    name: "WhatsApp",
    shortName: "WhatsApp",
    availability: "coming_soon",
    statusLabel: "Coming soon",
    description:
      "WhatsApp messaging support is planned for a future TENH Chat update.",
    canConnect: false,
  },
  {
    platform: "tiktok",
    name: "TikTok",
    shortName: "TikTok",
    availability: "coming_soon",
    statusLabel: "Coming soon",
    description:
      "TikTok messaging support is planned for a future TENH Chat update.",
    canConnect: false,
  },
] as const;

export function getTenhChannelDefinition(
  platform: string,
): TenhChannelDefinition | null {
  return (
    TENH_CHANNEL_CATALOG.find(
      (channel) => channel.platform === platform,
    ) ?? null
  );
}

export function isTenhChannelPlatform(
  value: string,
): value is TenhChannelPlatform {
  return TENH_CHANNEL_CATALOG.some(
    (channel) => channel.platform === value,
  );
}
