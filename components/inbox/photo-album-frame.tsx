import type { ReactNode } from "react";
export function PhotoAlbumFrame({count,hasReplyPreview=false,children}:{count:number;hasReplyPreview?:boolean;children:ReactNode}) {
  return <div data-photo-layout="album" className={`-mx-4 grid w-[300px] max-w-[calc(100%+2rem)] gap-[3px] overflow-hidden ${count===2?"grid-cols-1":count<=4?"grid-cols-2":"grid-cols-3"} ${hasReplyPreview?"mt-1":"-mt-3"} mb-1`}>{children}</div>;
}
