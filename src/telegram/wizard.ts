export type WizardKind = "addtarget" | "schedule";

export interface WizardState {
  kind: WizardKind;
  step: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

// Single-operator bot, so a plain in-memory map keyed by chat is enough —
// no need for persistence or multi-user session handling.
const wizards = new Map<number, WizardState>();

export function getWizard(chatId: number): WizardState | undefined {
  return wizards.get(chatId);
}

export function setWizard(chatId: number, state: WizardState): void {
  wizards.set(chatId, state);
}

export function clearWizard(chatId: number): void {
  wizards.delete(chatId);
}
