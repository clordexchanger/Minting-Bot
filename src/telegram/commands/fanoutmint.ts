import { Bot } from "grammy";
import { getTarget } from "../../config/targets.js";
import { listWallets } from "../../wallet/keystore.js";
import { executeMint } from "../../mint/executeMint.js";

// Not a race against yourself in the collision sense — each wallet has its
// own nonce and its own signed transaction, so there's nothing to serialize
// on. Firing all of them at once is genuinely parallel, which is the point:
// more independent attempts against a per-wallet-capped drop.
export function registerFanoutMint(bot: Bot): void {
  bot.command("fanoutmint", async (ctx) => {
    const raw = ctx.match?.toString().trim();
    if (!raw) {
      await ctx.reply("Usage: /fanoutmint <target> <label1,label2,...|all>\n\"all\" uses every evm wallet in the keystore.");
      return;
    }

    const [targetId, walletsRaw] = raw.split(/\s+/);
    const target = getTarget(targetId);
    if (!target) {
      await ctx.reply(`No target found matching "${targetId}". Check /listtargets.`);
      return;
    }
    if (target.chain !== "evm") {
      await ctx.reply("Fan-out mint currently only supports evm targets.");
      return;
    }

    const labels =
      walletsRaw === "all"
        ? listWallets()
            .filter((w) => w.chain === "evm")
            .map((w) => w.label)
        : walletsRaw.split(",").map((s) => s.trim()).filter(Boolean);

    if (labels.length === 0) {
      await ctx.reply("No wallets to fan out across. Check /wallets, or /newwallet to create one.");
      return;
    }

    await ctx.reply(`Firing ${target.label} from ${labels.length} wallet(s) in parallel: ${labels.join(", ")}`);

    await Promise.all(labels.map((label) => executeMint(bot, ctx.chat.id, target, label)));
  });
}
