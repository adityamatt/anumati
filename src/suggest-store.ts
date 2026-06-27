import { appendFileSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { Suggestion } from "./suggest.js";

export interface StoredSuggestion extends Suggestion {
  ts: string;
}

/** Default location for accumulated suggestions. */
export function defaultSuggestionsFile(): string {
  return join(homedir(), ".claude", "anumati-suggestions.jsonl");
}

/** Append a suggestion as one JSON line. Never throws — storage must not block the hook. */
export function storeSuggestion(suggestion: Suggestion, file?: string): void {
  const entry: StoredSuggestion = {
    ts: new Date().toISOString(),
    ...suggestion,
  };
  try {
    appendFileSync(file ?? defaultSuggestionsFile(), JSON.stringify(entry) + "\n");
  } catch {
    // never block execution
  }
}

/** Read all stored suggestions, skipping any malformed lines. */
export function readSuggestions(file?: string): StoredSuggestion[] {
  const path = file ?? defaultSuggestionsFile();
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as StoredSuggestion;
        } catch {
          return null;
        }
      })
      .filter((e): e is StoredSuggestion => e !== null);
  } catch {
    return [];
  }
}

/** Truncate the suggestions file. */
export function clearSuggestions(file?: string): void {
  try {
    writeFileSync(file ?? defaultSuggestionsFile(), "");
  } catch {
    // best effort
  }
}
