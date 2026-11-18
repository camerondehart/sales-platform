import { brand } from "@/lib/brand";
import { redirect } from "next/navigation";
import { getApprovedVisitor } from "@/lib/auth";
import { isEnabled } from "@/lib/flags";
import { getSettings } from "@/lib/settings";
import { DEFAULT_GIFT_BONUS } from "@/lib/giftCardRules";
import Scene from "@/app/components/Scene";
import GiftCardsClient from "./GiftCardsClient";

export const metadata = {
  title: `Gift cards · ${brand.members}`,
  description: `Send a ${brand.shortName} gift card for a birthday, the holidays, or just because.`,
};

export const dynamic = "force-dynamic";

// Members-only, like the shop the cards are spent in.
export default async function GiftCardsPage() {
  const user = await getApprovedVisitor();
  if (!user) redirect("/?next=/gift-cards");
  if (!(await isEnabled("gift_cards").catch(() => false))) redirect("/gallery");
  const s = await getSettings();
  const bonus = {
    enabled: s.giftBonusEnabled ?? DEFAULT_GIFT_BONUS.enabled,
    per: s.giftBonusPer ?? DEFAULT_GIFT_BONUS.per,
    step: s.giftBonusStep ?? DEFAULT_GIFT_BONUS.step,
    max: s.giftBonusMax ?? DEFAULT_GIFT_BONUS.max,
  };
  return (
    <>
      <Scene variant="soft" />
      <GiftCardsClient userName={user.name} bonus={bonus} />
    </>
  );
}
