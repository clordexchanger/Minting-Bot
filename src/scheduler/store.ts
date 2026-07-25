import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export interface ScheduleEntry {
  id: string;
  targetId: string;
  walletLabel: string;
  fireAtIso: string;
  chatId: number;
  createdAt: string;
}

const SCHEDULES_FILE = "./data/schedules.json";

function ensureFile(): void {
  const dir = dirname(SCHEDULES_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(SCHEDULES_FILE)) writeFileSync(SCHEDULES_FILE, "[]", "utf-8");
}

function load(): ScheduleEntry[] {
  ensureFile();
  return JSON.parse(readFileSync(SCHEDULES_FILE, "utf-8")) as ScheduleEntry[];
}

function save(entries: ScheduleEntry[]): void {
  ensureFile();
  writeFileSync(SCHEDULES_FILE, JSON.stringify(entries, null, 2), "utf-8");
}

export function listSchedules(): ScheduleEntry[] {
  return load();
}

export function addSchedule(input: Omit<ScheduleEntry, "id" | "createdAt">): ScheduleEntry {
  const entries = load();
  const entry: ScheduleEntry = { ...input, id: randomUUID().slice(0, 8), createdAt: new Date().toISOString() };
  entries.push(entry);
  save(entries);
  return entry;
}

export function removeSchedule(id: string): boolean {
  const entries = load();
  const next = entries.filter((e) => e.id !== id);
  const removed = next.length !== entries.length;
  if (removed) save(next);
  return removed;
}
