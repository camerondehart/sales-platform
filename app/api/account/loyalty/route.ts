import { NextResponse } from "next/server";
import { getApprovedVisitor } from "@/lib/auth";
import { pointsBalance, pointsToDollars } from "@/lib/loyalty";
import { getSettings } from "@/lib/settings";

// A member's own loyalty balance and history.
export async function GET() {
  const user = await getApprovedVisitor();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const settings = await getSettings();
  const balance = pointsBalance(user);

  return NextResponse.json({
    loyalty: {
      enabled: settings.loyaltyEnabled,
      points: balance,
      dollarValue: await pointsToDollars(balance),
      pointsPerDollar: settings.pointsPerDollar,
      pointsPerDollarRedeemed: settings.pointsPerDollarRedeemed,
      minPointsToRedeem: settings.minPointsToRedeem,
      history: (user.pointsHistory || []).slice().reverse().slice(0, 50),
    },
  });
}
