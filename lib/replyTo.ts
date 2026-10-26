import { brand } from "@/lib/brand";
/**
 * Where customers' replies go. Every email a customer receives sets this as
 * Reply-To, so the "From" address (e.g. hello@your-domain) never needs a
 * real mailbox. Override with CUSTOMER_REPLY_TO in Vercel if it ever changes.
 */
export const customerReplyTo = () => process.env.CUSTOMER_REPLY_TO?.trim() || brand.supportEmail;
