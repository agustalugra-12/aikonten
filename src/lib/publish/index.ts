import type { Publisher } from "./types";
import { publishToInstagram } from "./instagram";
import { publishToFacebook } from "./facebook";
import { publishToYoutube } from "./youtube";
import { publishToTiktokViaBuffer } from "./buffer";

// Dispatcher: platform + publishVia -> implementasi yang benar. publishVia menentukan
// TikTok lewat Buffer, platform lain native - lihat PRD diskusi & schema.ts.
export function getPublisher(platform: string, publishVia: string): Publisher | null {
  if (platform === "tiktok" && publishVia === "buffer") return publishToTiktokViaBuffer;
  if (platform === "instagram" && publishVia === "native") return publishToInstagram;
  if (platform === "facebook" && publishVia === "native") return publishToFacebook;
  if (platform === "youtube" && publishVia === "native") return publishToYoutube;
  return null;
}

export * from "./types";
export { sendTelegramNotification, formatPublishNotification } from "./telegram";
