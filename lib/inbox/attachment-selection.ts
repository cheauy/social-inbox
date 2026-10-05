export type SelectedAttachmentKind =
  | "image"
  | "video"
  | "audio"
  | "file";

export const DIRECT_ATTACHMENT_ACCEPT =
  "image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf,.odt,.ods,.odp,.zip,.rar,.7z,.json,.xml,.mp3,.wav";

const LIMITS = {
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  file: 25 * 1024 * 1024,
} satisfies Record<SelectedAttachmentKind, number>;

const SUPPORTED_FILE_EXTENSION =
  /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|rtf|odt|ods|odp|zip|rar|7z|json|xml)$/i;

const SUPPORTED_AUDIO_EXTENSION =
  /\.(mp3|wav)$/i;

export type AttachmentSelectionRejection = {
  file: File;
  reason: string;
};

function classify(file: File): SelectedAttachmentKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (SUPPORTED_AUDIO_EXTENSION.test(file.name)) return "audio";
  if (SUPPORTED_FILE_EXTENSION.test(file.name)) return "file";
  return null;
}

function sizeLabel(bytes: number) {
  return `${bytes / (1024 * 1024)} MB`;
}

export function selectAttachments(
  files: FileList | File[] | null,
  {
    platform,
    existingVideoCount = 0,
    imagesOnly = false,
  }: {
    platform?: string;
    existingVideoCount?: number;
    imagesOnly?: boolean;
  } = {},
) {
  const accepted: Array<{
    file: File;
    kind: SelectedAttachmentKind;
  }> = [];
  const rejected: AttachmentSelectionRejection[] = [];
  let videoCount = existingVideoCount;

  for (const file of Array.from(files ?? [])) {
    const kind = classify(file);

    if (!kind || (imagesOnly && kind !== "image")) {
      rejected.push({ file, reason: "unsupported file type" });
      continue;
    }

    if (kind === "video" && videoCount > 0) {
      rejected.push({ file, reason: "only one video can be attached" });
      continue;
    }

    if (platform === "telegram" && file.size > 4 * 1024 * 1024) {
      rejected.push({ file, reason: "Telegram attachments are limited to 4 MB" });
      continue;
    }

    if (
      platform === "telegram" &&
      kind === "video" &&
      file.type.split(";")[0].trim().toLowerCase() !== "video/mp4" &&
      !file.name.toLowerCase().endsWith(".mp4")
    ) {
      rejected.push({ file, reason: "Telegram video must be MP4" });
      continue;
    }

    if (file.size > LIMITS[kind]) {
      rejected.push({
        file,
        reason: `exceeds the ${sizeLabel(LIMITS[kind])} ${kind} limit`,
      });
      continue;
    }

    accepted.push({ file, kind });
    if (kind === "video") videoCount += 1;
  }

  return { accepted, rejected };
}
