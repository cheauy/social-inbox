export type FacebookMessengerReferral = {
  ref?: string;
  ad_id?: string;
  post_id?: string;
  source?: string;
  type?: string;
  ads_context_data?: {
    ad_title?: string;
    photo_url?: string;
    video_url?: string;
    post_id?: string;
    product_id?: string;
    flow_id?: string;
  };
};

export type FacebookAttachment = {
  type?: string;
  payload?: {
    url?: string;
    sticker_id?: number | string;
  };
};

export type FacebookMessagingEvent = {
  sender?: {
    id?: string;
    user_ref?: string;
  };

  recipient?: {
    id?: string;
  };

  timestamp?: number;

  referral?: FacebookMessengerReferral;

  reaction?: {
    mid?: string;
    action?: string;
    emoji?: string;
    reaction?: string;
  };

  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    referral?: FacebookMessengerReferral;
    reply_to?: { mid?: string; is_self_reply?: boolean };
    attachments?: FacebookAttachment[];
  };

  postback?: {
    mid?: string;
    title?: string;
    payload?: string;
    referral?: FacebookMessengerReferral;
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
