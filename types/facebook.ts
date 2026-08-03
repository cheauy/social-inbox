export type FacebookAttachment = {
  type?: string;
  payload?: {
    url?: string;
    sticker_id?: number;
  };
};

export type FacebookMessagingEvent = {
  sender?: {
    id?: string;
  };

  recipient?: {
    id?: string;
  };

  timestamp?: number;

  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    attachments?: FacebookAttachment[];
  };

  postback?: {
    title?: string;
    payload?: string;
  };

  delivery?: {
    mids?: string[];
    watermark?: number;
  };

  read?: {
    watermark?: number;
  };
};

export type FacebookWebhookPayload = {
  object?: string;

  entry?: Array<{
    id?: string;
    time?: number;
    messaging?: FacebookMessagingEvent[];
  }>;
};