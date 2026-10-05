import { redirect } from "next/navigation";

/* Telegram Personal chats now live in the one TENH inbox, under their channel. */
export default function TelegramPersonalInboxPage() {
  redirect("/dashboard/inbox");
}
