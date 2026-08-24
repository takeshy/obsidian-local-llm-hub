import type { Message } from "src/types";
import { t } from "src/i18n";

export function buildErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : t("chat.unknownError");
  return t("chat.errorOccurred", { message });
}

export function isCaretOnFirstLine(value: string, caret: number): boolean {
  return !value.slice(0, caret).includes("\n");
}

export function isCaretOnLastLine(value: string, caret: number): boolean {
  return !value.slice(caret).includes("\n");
}

export interface ChatHistory {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}
