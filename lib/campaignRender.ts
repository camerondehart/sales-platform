import { wrapCampaign } from "./campaignEmail";
import { resolveTheme, type ThemeChoice } from "./campaignThemes";
import { themeArt } from "./emailArt";

/**
 * One campaign email as recipients see it: the body in its theme's layout
 * (seasonal banner, colours, dividers) or the plain layout for "none".
 * Used by the test send, the real send and the dashboard preview, so all
 * three always match.
 */
export async function renderCampaign(input: {
  subject: string;
  body: string;
  /** Campaigns saved before themes existed have none: they keep the plain look. */
  theme: ThemeChoice | undefined;
  unsubUrl: string;
  name?: string;
  siteUrl: string;
  /** "auto" picks the season from this date (the send time). */
  when?: number;
}): Promise<string> {
  const theme = resolveTheme(input.theme ?? "none", input.subject, input.body, input.when);
  if (!theme) return wrapCampaign(input.body, input.unsubUrl, input.name, { siteUrl: input.siteUrl });
  const art = await themeArt(theme.key, input.siteUrl);
  return wrapCampaign(input.body, input.unsubUrl, input.name, { theme, art, siteUrl: input.siteUrl });
}
