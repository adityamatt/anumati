import type { HookInput, Rule } from "../types.js";
import { matchCurl } from "./curl.js";
import { matchNpxTsc } from "./npx-tsc.js";
import { matchPython3Pipe } from "./python3-pipe.js";
import { matchNodejsPipe } from "./nodejs-pipe.js";
import { matchGh } from "./gh.js";
import { matchPip3Install } from "./pip3-install.js";
import { matchSafeInspect } from "./safe-inspect.js";
import { matchGitRead } from "./git-read.js";
import { matchGitWrite } from "./git-write.js";
import { matchNpmScript } from "./npm-script.js";
import { matchCargo } from "./cargo.js";
import { matchGo } from "./go.js";
import { matchCd } from "./cd.js";
import { matchVitest } from "./vitest.js";
import { matchAws } from "./aws.js";
import { matchSleep } from "./sleep.js";
import { matchEcho } from "./echo.js";
import { matchSed } from "./sed.js";
import { matchJq } from "./jq.js";
import { matchTestRunner } from "./test-runner.js";

export function matchNamed(matcher: string, input: HookInput, rule: Rule): boolean {
  const cmd = input.tool_input.command ?? "";

  switch (matcher) {
    case "curl":         return matchCurl(cmd, rule.allowed_domains ?? [], rule.allowed_imports ?? [], rule.open?.allowed_paths ?? [], rule.scheme ?? "https");
    case "npx-tsc":      return matchNpxTsc(cmd);
    case "python3-pipe": return matchPython3Pipe(cmd, rule.allowed_imports ?? [], rule.open?.allowed_paths ?? [], input.cwd ?? "");
    case "nodejs-pipe":  return matchNodejsPipe(cmd, rule.allowed_modules ?? [], input.cwd ?? "", rule.open?.allowed_paths ?? []);
    case "gh":           return matchGh(cmd, rule.allowed_repos ?? [], rule.allowed_imports ?? [], rule.open?.allowed_paths ?? []);
    case "pip3-install": return matchPip3Install(cmd, rule.allowed_packages ?? []);
    case "safe-inspect": return matchSafeInspect(cmd);
    case "git-read":     return matchGitRead(cmd);
    case "git-write":    return matchGitWrite(cmd, rule.allowed_git_ops ?? []);
    case "npm-script":   return matchNpmScript(cmd, rule.allowed_scripts ?? []);
    case "cargo":        return matchCargo(cmd);
    case "go":           return matchGo(cmd);
    case "cd":           return matchCd(cmd, input.cwd ?? "");
    case "vitest":       return matchVitest(cmd);
    case "aws":          return matchAws(cmd);
    case "sleep":        return matchSleep(cmd);
    case "echo":         return matchEcho(cmd);
    case "sed":          return matchSed(cmd);
    case "jq":           return matchJq(cmd);
    case "test-runner":  return matchTestRunner(cmd);
    default:             return false;
  }
}
