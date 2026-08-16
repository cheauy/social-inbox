export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramChat = {
  id: number;
  type: string;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type TelegramPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};


export type TelegramDocument = {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TelegramAudio = {
  file_id: string;
  file_unique_id: string;
  duration: number;
  performer?: string;
  title?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TelegramVoice = {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
};

export type TelegramMessage = {
  message_id: number;
  date: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  audio?: TelegramAudio;
  voice?: TelegramVoice;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

export type TelegramApiEnvelope<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
};

export type TelegramWebhookInfo = {
  url: string;
  has_custom_certificate?: boolean;
  pending_update_count: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  max_connections?: number;
  allowed_updates?: string[];
};

export type TelegramUserProfilePhotos = {
  total_count: number;
  photos: TelegramPhotoSize[][];
};

export type TelegramFile = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
};
