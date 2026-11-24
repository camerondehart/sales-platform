/** What each kind of Today task's button does (shared by the Today route and the manager review). */
// What each kind of task's button does. Prompts stay under the widget's 300 characters.
export function actionFor(task: string): { key: string; ask?: string; tab?: string; button: string } {
  if (/^Reply to/i.test(task)) return { key: "requests", tab: "assistant", button: "Open replies" };
  if (/membership request/i.test(task))
    return {
      key: "members",
      ask: "Prepare a card for each membership request that's waiting, so I can approve or decline each one. Point out anyone who didn't confirm 21+.",
      button: "Prepare approval cards",
    };
  if (/^Chase/i.test(task))
    return {
      key: "unpaid",
      ask: "Prepare payment reminder cards (with the pay button) for the unpaid orders on today's Chase list (daily_tasks) — one card per order, up to 10. Skip cash-at-pickup orders and any chased in the last 3 days.",
      button: "Prepare reminder cards",
    };
  if (/^Pack and/i.test(task))
    return {
      key: "fulfil",
      ask: "For the paid orders waiting to go out: prepare a shipping label card for each shipping order that still needs a label (leave the weight out — it's worked out from product weights), and a 'mark completed' card for each order that's ready. One card per order.",
      button: "Prepare shipping cards",
    };
  if (/event/i.test(task)) return { key: "events", tab: "events", button: "Open events" };
  if (/discount code/i.test(task)) return { key: "codes", tab: "marketing", button: "Open codes" };
  return { key: "other", tab: "overview", button: "Open" };
}

