import fs from "fs";
import path from "path";
import { configDir } from "./broker-config-store";

export interface TelegramConfig { botToken: string; chatId: string }

function configPath(): string {
  return path.join(configDir(), "telegram-config.json");
}

export function getTelegramConfig(): TelegramConfig | null {
  try {
    const raw = fs.readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.botToken && parsed.chatId) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function saveTelegramConfig(cfg: TelegramConfig) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), "utf-8");
}

export function deleteTelegramConfig() {
  try { fs.unlinkSync(configPath()); } catch { /* already gone */ }
}
