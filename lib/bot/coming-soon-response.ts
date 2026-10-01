import { NextResponse } from "next/server";
export function tenhBotComingSoonResponse(){
 return NextResponse.json({error:"Tenh Bot is coming soon. Configuration and execution are paused.",code:"TENH_BOT_COMING_SOON",paused:true,processed:0},{status:503,headers:{"Cache-Control":"no-store"}});
}
