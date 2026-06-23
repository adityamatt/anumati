import type { HookInput, Rule } from "../types.js";
import { matchCurl } from "./curl.js";
import { matchNpxTsc } from "./npx-tsc.js";
import { matchSafeRead } from "./safe-read.js";
import { matchPython3Pipe } from "./python3-pipe.js";
import { matchGh } from "./gh.js";
import { matchPip3Install } from "./pip3-install.js";

export function matchNamed(matcher: string, input: HookInput, rule: Rule): boolean {
  const cmd = input.tool_input.command ?? "";
  const filePath = input.tool_input.file_path ?? "";

  switch (matcher) {
    case "curl":         return matchCurl(cmd, rule.allowed_domains ?? [], rule.allowed_imports ?? [], rule.open?.allowed_paths ?? []);
    case "npx-tsc":      return matchNpxTsc(cmd);
    case "safe-read":    return matchSafeRead(filePath);
    case "python3-pipe": return matchPython3Pipe(cmd, rule.allowed_imports ?? [], rule.open?.allowed_paths ?? [], input.cwd ?? "");
    case "gh":           return matchGh(cmd, rule.allowed_repos ?? [], rule.allowed_imports ?? [], rule.open?.allowed_paths ?? []);
    case "pip3-install": return matchPip3Install(cmd, rule.allowed_packages ?? []);
    default:             return false;
  }
}
