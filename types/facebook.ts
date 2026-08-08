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

  entry?: {
    id?: string;

    messaging?: FacebookMessagingEvent[];

    changes?: FacebookWebhookChange[];
  }[];
};

export type FacebookFeedCommentValue = {
  item?: string;
  verb?: "add" | "remove" | string;

  comment_id?: string;
  post_id?: string;
  parent_id?: string;

  created_time?: number;

  message?: string;

  from?: {
    id?: string;
    name?: string;
  };
};

export type FacebookWebhookChange = {
  field?: string;
  value?: FacebookFeedCommentValue;
};