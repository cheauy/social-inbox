import { Children, cloneElement, isValidElement, type CSSProperties, type ReactNode } from "react";
export function PhotoAlbumFrame({count,hasReplyPreview=false,children}:{count:number;hasReplyPreview?:boolean;children:ReactNode}) {
  return <div data-photo-layout="album" className={`-mx-4 grid w-[300px] max-w-[calc(100%+2rem)] grid-cols-6 overflow-hidden ${hasReplyPreview?"mt-1":"-mt-3"} mb-1`}>{Children.toArray(children).map((child,index)=>{
    if(index>=count || !isValidElement<{style?:CSSProperties}>(child)) return child;
    const wide=count<=2 || (count===3 && index===0) || (count>4 && count%3===1 && index===count-1);
    const half=!wide && (count<=4 || (count%3===2 && index>=count-2));
    return cloneElement(child,{style:{...child.props.style,gridColumn:`span ${wide?6:half?3:2}`,aspectRatio:wide?"3 / 2":"1 / 1"}});
  })}</div>;
}
