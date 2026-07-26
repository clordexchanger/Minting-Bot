import type { Context } from "grammy";

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/**
 * Sends text via ctx.reply, splitting into multiple messages if it exceeds
 * Telegram's 4096-character limit — Telegram just rejects the whole send
 * with a 400 otherwise, which looks like the bot silently ignored the
 * command unless you're watching the logs. Splits on line breaks where
 * possible so a command example or sentence doesn't get cut in half.
 */
export async function replyLong(
  ctx: Context,
  text: string,
  options?: Parameters<Context["reply"]>[1]
): Promise<void> {
  if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) {
    await ctx.reply(text, options);
    return;
  }

  const lines = text.split("\n");
  let chunk = "";

  for (const line of lines) {
    if (chunk.length + line.length + 1 > TELEGRAM_MAX_MESSAGE_LENGTH) {
      if (chunk) {
        await ctx.reply(chunk, options);
        chunk = "";
      }
      // A single line longer than the whole limit on its own — hard-split it,
      // since there's no line break to split on within it.
      if (line.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
        for (let i = 0; i < line.length; i += TELEGRAM_MAX_MESSAGE_LENGTH) {
          await ctx.reply(line.slice(i, i + TELEGRAM_MAX_MESSAGE_LENGTH), options);
        }
        continue;
      }
    }
    chunk = chunk ? `${chunk}\n${line}` : line;
  }

  if (chunk) {
    await ctx.reply(chunk, options);
  }
}
