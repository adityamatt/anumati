import type { HookInput, Rule } from "../types.js";
import { matchCurl } from "./curl.js";
import { matchNpxTsc } from "./npx-tsc.js";
import { matchSafeRead } from "./safe-read.js";
import { matchSafeWrite } from "./safe-write.js";
import { matchPython3Pipe } from "./python3-pipe.js";
import { matchNodejsPipe } from "./nodejs-pipe.js";
import { matchGh } from "./gh.js";
import { matchPip3Install } from "./pip3-install.js";
import { matchSafeInspect } from "./safe-inspect.js";
import { matchGitRead } from "./git-read.js";
import { matchNpmScript } from "./npm-script.js";
import { matchCargo } from "./cargo.js";
import { matchGo } from "./go.js";

export function matchNamed(matcher: string, input: HookInput, rule: Rule): boolean {
  const cmd = input.tool_input.command ?? "";
  const filePath = input.tool_input.file_path ?? "";

  switch (matcher) {
    case "curl":         return matchCurl(cmd, rule.allowed_domains ?? [], rule.allowed_imports ?? [], rule.open?.allowed_paths ?? []);
    case "npx-tsc":      return matchNpxTsc(cmd);
    case "safe-read":    return matchSafeRead(filePath);
    case "safe-write":   return matchSafeWrite(filePath, rule.allowed_write_paths ?? [], input.cwd ?? "");
    case "python3-pipe": return matchPython3Pipe(cmd, rule.allowed_imports ?? [], rule.open?.allowed_paths ?? [], input.cwd ?? "");
    case "nodejs-pipe":  return matchNodejsPipe(cmd, rule.allowed_modules ?? [], input.cwd ?? "");
    case "gh":           return matchGh(cmd, rule.allowed_repos ?? [], rule.allowed_imports ?? [], rule.open?.allowed_paths ?? []);
    case "pip3-install": return matchPip3Install(cmd, rule.allowed_packages ?? []);
    case "safe-inspect": return matchSafeInspect(cmd);
    case "git-read":     return matchGitRead(cmd);
    case "npm-script":   return matchNpmScript(cmd, rule.allowed_scripts ?? []);
    case "cargo":        return matchCargo(cmd);
    case "go":           return matchGo(cmd);
    default:             return false;
  }
}
