import { notFound } from "next/navigation";

import { TikTokReviewPrototype } from "./tiktok-review-prototype";

export default function TikTokReviewPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return <TikTokReviewPrototype />;
}
