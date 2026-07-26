import { Bot, InlineKeyboard, Context } from "grammy";
import { addTarget, Chain } from "../../config/targets.js";
import { listWallets } from "../../wallet/keystore.js";
import { getWizard, setWizard, clearWizard } from "../wizard.js";

const COMMON_CHAINS: Array<[string, number]> = [
  ["Ethereum", 1],
  ["Base", 8453],
  ["Arbitrum", 42161],
  ["Base Sepolia", 84532],
  ["Arbitrum Sepolia", 421614],
  ["Ethereum Sepolia", 11155111],
];

export function registerAddTarget(bot: Bot): void {
  // ---- Fast path: the original one-line pipe|JSON syntax, unchanged. ----
  bot.command("addtarget", async (ctx, next) => {
    const raw = ctx.match?.toString().trim();
    if (!raw) return next(); // no args — hand off to the guided wizard below

    const parts = raw.split("|").map((p) => p.trim());
    const [label, chainRaw, address, mintSpec, chainIdRaw, priceNote, wallet] = parts;

    if (!label || !chainRaw || !address || !mintSpec) {
      await ctx.reply("Missing required fields. Need at least: label|chain|address|mintSpec\n\nOr just run /addtarget with no arguments for a guided walk-through instead.");
      return;
    }
    if (chainRaw !== "evm" && chainRaw !== "solana") {
      await ctx.reply(`Invalid chain "${chainRaw}". Must be "evm" or "solana".`);
      return;
    }
    const chain = chainRaw as Chain;
    if (chain === "evm" && !chainIdRaw) {
      await ctx.reply("EVM targets need a chainId (e.g. 1 for mainnet, 8453 for Base).");
      return;
    }

    const target = addTarget({
      label,
      chain,
      address,
      mintSpec,
      chainId: chainIdRaw ? Number(chainIdRaw) : undefined,
      priceNote: priceNote || undefined,
      wallet: wallet || undefined,
    });

    await ctx.reply(
      `Target added: *${target.label}* (${target.id})\nChain: ${target.chain}${
        target.chainId ? " / chainId " + target.chainId : ""
      }\nAddress: \`${target.address}\``,
      { parse_mode: "Markdown" }
    );
  });

  // ---- Guided wizard: /addtarget with no arguments. EVM only — solana's
  // mintSpec is too free-form (raw instruction bytes + accounts) to
  // meaningfully walk through with yes/no questions. ----
  bot.command("addtarget", async (ctx) => {
    const raw = ctx.match?.toString().trim();
    if (raw) return; // already handled by the fast-path handler above

    setWizard(ctx.chat.id, { kind: "addtarget", step: 0, data: {} });
    await ctx.reply(
      "Let's add a mint target — evm only for this guided flow (solana still needs the manual /addtarget syntax, see /help).\n\n" +
        "What label do you want? (short name, e.g. coolcats)\n\nSend /cancel any time to stop."
    );
  });

  bot.on("message:text", async (ctx, next) => {
    const wizard = getWizard(ctx.chat.id);
    if (!wizard || wizard.kind !== "addtarget") return next();
    const text = ctx.message.text.trim();

    // Any real command (including /cancel) should escape the wizard rather
    // than being swallowed as if it were an answer to the current question.
    if (text.startsWith("/")) {
      clearWizard(ctx.chat.id);
      return next();
    }

    const data = wizard.data;

    switch (wizard.step) {
      case 0: {
        data.label = text;
        wizard.step = 1;
        setWizard(ctx.chat.id, wizard);
        await ctx.reply("Contract address? (0x... — 40 hex characters)");
        return;
      }
      case 1: {
        if (!/^0x[a-fA-F0-9]{40}$/.test(text)) {
          await ctx.reply("That doesn't look like a valid address — needs to be 0x followed by 40 hex characters. Try again, or /cancel.");
          return;
        }
        data.address = text;
        wizard.step = 2;
        setWizard(ctx.chat.id, wizard);
        const kb = new InlineKeyboard();
        COMMON_CHAINS.forEach(([name, id], i) => {
          kb.text(name, `wiz_chain_${id}`);
          if (i % 2 === 1) kb.row();
        });
        kb.row().text("Other (type it in)", "wiz_chain_other");
        await ctx.reply("Which chain?", { reply_markup: kb });
        return;
      }
      case 2: {
        // Only reached if they picked "Other" above.
        const chainId = Number(text);
        if (!Number.isInteger(chainId) || chainId <= 0) {
          await ctx.reply("That's not a valid chain ID — should be a whole number. Try again, or /cancel.");
          return;
        }
        data.chainId = chainId;
        await askQuantityQuestion(ctx);
        return;
      }
      case 4: {
        const qty = Number(text);
        if (!Number.isInteger(qty) || qty <= 0) {
          await ctx.reply("Enter a whole number greater than 0, or /cancel.");
          return;
        }
        data.qty = qty;
        await askPayableQuestion(ctx);
        return;
      }
      case 6: {
        data.priceEth = text;
        await askWalletQuestion(ctx);
        return;
      }
      default:
        return next();
    }
  });

  bot.callbackQuery(/^wiz_chain_(\d+|other)$/, async (ctx) => {
    const wizard = getWizard(ctx.chat!.id);
    if (!wizard || wizard.kind !== "addtarget") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    const match = ctx.match![1];
    if (match === "other") {
      wizard.step = 2;
      setWizard(ctx.chat!.id, wizard);
      await ctx.reply("Type the chain ID (a number):");
      return;
    }
    wizard.data.chainId = Number(match);
    await askQuantityQuestion(ctx);
  });

  bot.callbackQuery(/^wiz_qty_(yes|no)$/, async (ctx) => {
    const wizard = getWizard(ctx.chat!.id);
    if (!wizard || wizard.kind !== "addtarget") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    wizard.data.hasQty = ctx.match![1] === "yes";
    if (wizard.data.hasQty) {
      wizard.step = 4;
      setWizard(ctx.chat!.id, wizard);
      await ctx.reply("How many to mint per call? (e.g. 1)");
    } else {
      await askPayableQuestion(ctx);
    }
  });

  bot.callbackQuery(/^wiz_pay_(yes|no)$/, async (ctx) => {
    const wizard = getWizard(ctx.chat!.id);
    if (!wizard || wizard.kind !== "addtarget") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    wizard.data.payable = ctx.match![1] === "yes";
    if (wizard.data.payable) {
      wizard.step = 6;
      setWizard(ctx.chat!.id, wizard);
      await ctx.reply("Price in ETH per mint? (e.g. 0.01)");
    } else {
      await askWalletQuestion(ctx);
    }
  });

  bot.callbackQuery(/^wiz_wallet_(.+)$/, async (ctx) => {
    const wizard = getWizard(ctx.chat!.id);
    if (!wizard || wizard.kind !== "addtarget") {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.answerCallbackQuery();
    const choice = ctx.match![1];
    wizard.data.wallet = choice === "none" ? undefined : choice;
    clearWizard(ctx.chat!.id);
    await finalizeAddTarget(ctx, wizard.data);
  });
}

async function askQuantityQuestion(ctx: Context): Promise<void> {
  const wizard = getWizard(ctx.chat!.id)!;
  wizard.step = 3;
  setWizard(ctx.chat!.id, wizard);
  const kb = new InlineKeyboard().text("Yes", "wiz_qty_yes").text("No", "wiz_qty_no");
  await ctx.reply("Does the mint function take a quantity argument, like mint(uint256 quantity)?", { reply_markup: kb });
}

async function askPayableQuestion(ctx: Context): Promise<void> {
  const wizard = getWizard(ctx.chat!.id)!;
  wizard.step = 5;
  setWizard(ctx.chat!.id, wizard);
  const kb = new InlineKeyboard().text("Yes", "wiz_pay_yes").text("No", "wiz_pay_no");
  await ctx.reply("Does minting cost ETH — is the function payable?", { reply_markup: kb });
}

async function askWalletQuestion(ctx: Context): Promise<void> {
  const wizard = getWizard(ctx.chat!.id)!;
  const wallets = listWallets().filter((w) => w.chain === "evm");
  if (wallets.length === 0) {
    clearWizard(ctx.chat!.id);
    await finalizeAddTarget(ctx, wizard.data);
    return;
  }
  wizard.step = 7;
  setWizard(ctx.chat!.id, wizard);
  const kb = new InlineKeyboard();
  wallets.forEach((w, i) => {
    kb.text(w.label, `wiz_wallet_${w.label}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text("None / set later", "wiz_wallet_none");
  await ctx.reply("Default wallet for this target?", { reply_markup: kb });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function finalizeAddTarget(ctx: Context, data: Record<string, any>): Promise<void> {
  if (!data.label || !data.address || !data.chainId) {
    await ctx.reply("Something went wrong building the target — missing required info. Start over with /addtarget.");
    return;
  }

  const functionAbi = data.hasQty
    ? `function mint(uint256 quantity) ${data.payable ? "payable" : ""}`.trim()
    : `function mint() ${data.payable ? "payable" : ""}`.trim();

  const mintSpec = JSON.stringify({
    functionAbi,
    args: data.hasQty ? [data.qty ?? 1] : [],
    ...(data.payable && data.priceEth ? { valueEth: data.priceEth } : {}),
  });

  const target = addTarget({
    label: data.label,
    chain: "evm",
    address: data.address,
    mintSpec,
    chainId: data.chainId,
    priceNote: data.payable && data.priceEth ? `${data.priceEth} ETH` : undefined,
    wallet: data.wallet,
  });

  await ctx.reply(
    `Target added: ${target.label} (${target.id})\nChain: evm / chainId ${target.chainId}\nAddress: ${target.address}\n\n` +
      `Try /dryrun ${target.label} to check it before minting for real. If the mint function is more complex than a simple quantity/payable call, edit it directly with /addtarget using the full pipe|JSON syntax (see /help).`
  );
}
