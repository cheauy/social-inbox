"use client";
/* Signed private media intentionally bypasses the image proxy. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef } from "react";
import { Images } from "lucide-react";
import type { WorkspaceStorageFile } from "@/lib/storage/workspace-storage-cache";

export function WorkspaceStorageThumbnail({ file, renew }: {
  file: WorkspaceStorageFile;
  renew: (file: WorkspaceStorageFile, failed?: boolean) => Promise<void>;
}) {
  const element = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let visible = false;
    const check = () => { if (visible && (!file.previewUrl || (file.previewExpiresAt ?? 0) <= Date.now() + 60_000)) void renew(file); };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; check(); }, { rootMargin: "150px" });
    if (element.current) observer.observe(element.current);
    const interval = window.setInterval(check, 30_000);
    const online = () => check();
    window.addEventListener("online", online);
    return () => { observer.disconnect(); window.clearInterval(interval); window.removeEventListener("online", online); };
  }, [file, renew]);
  return <span ref={element} className="block h-full w-full">
    {file.kind === "image" && file.previewUrl
      ? <img src={file.previewUrl} alt="" loading="lazy" onError={() => void renew(file, true)} className="h-full w-full object-cover" />
      : file.kind === "video" && file.previewUrl
        ? <video src={file.previewUrl} preload="none" muted playsInline onError={() => void renew(file, true)} className="h-full w-full object-cover" />
        : <Images className="mx-auto text-[#6D7E91]" />}
  </span>;
}
