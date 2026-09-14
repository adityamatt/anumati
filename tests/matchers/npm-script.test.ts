import { describe, it, expect } from "vitest";
import { matchNpmScript } from "../../src/matchers/npm-script.js";

const SCRIPTS = ["build", "test", "lint", "typecheck"];

describe("matchNpmScript — pipe to consumers", () => {
  it("allows npm run build | tail", () => {
    expect(matchNpmScript("npm run build | tail -1", SCRIPTS)).toBe(true);
  });
  it("allows npm run build 2>&1 | tail", () => {
    expect(matchNpmScript("npm run build 2>&1 | tail -1", SCRIPTS)).toBe(true);
  });
  it("allows npm run build with a bare 2>&1", () => {
    expect(matchNpmScript("npm run build 2>&1", SCRIPTS)).toBe(true);
  });
  it("blocks pipe to an unsafe consumer", () => {
    expect(matchNpmScript("npm run build | sh", SCRIPTS)).toBe(false);
  });
  it("blocks a file redirect", () => {
    expect(matchNpmScript("npm run build > out.txt", SCRIPTS)).toBe(false);
  });
  it("still allows -- passthrough args", () => {
    expect(matchNpmScript("npm run build -- --flag", SCRIPTS)).toBe(true);
  });
});

describe("matchNpmScript — run scripts (allowlisted)", () => {
  it("allows npm run build", () => {
    expect(matchNpmScript("npm run build", SCRIPTS)).toBe(true);
  });

  it("allows npm run test", () => {
    expect(matchNpmScript("npm run test", SCRIPTS)).toBe(true);
  });

  it("allows pnpm run lint", () => {
    expect(matchNpmScript("pnpm run lint", SCRIPTS)).toBe(true);
  });

  it("allows yarn run typecheck", () => {
    expect(matchNpmScript("yarn run typecheck", SCRIPTS)).toBe(true);
  });

  it("allows bare yarn <script>", () => {
    expect(matchNpmScript("yarn lint", SCRIPTS)).toBe(true);
  });

  it("allows bare pnpm <script>", () => {
    expect(matchNpmScript("pnpm build", SCRIPTS)).toBe(true);
  });

  it("allows bare npm test", () => {
    expect(matchNpmScript("npm test", SCRIPTS)).toBe(true);
  });

  it("allows pnpm test", () => {
    expect(matchNpmScript("pnpm test", SCRIPTS)).toBe(true);
  });

  it("allows yarn test", () => {
    expect(matchNpmScript("yarn test", SCRIPTS)).toBe(true);
  });

  it("allows npm run test -- --watch=false", () => {
    expect(matchNpmScript("npm run test -- --watch=false", SCRIPTS)).toBe(true);
  });

  it("allows npm run build && echo done", () => {
    expect(matchNpmScript("npm run build && echo done", SCRIPTS)).toBe(true);
  });

  it("allows npm run build && echo with quotes", () => {
    expect(matchNpmScript('npm run build && echo "all done"', SCRIPTS)).toBe(true);
  });
});

describe("matchNpmScript — read-only queries (no allowlist needed)", () => {
  it("allows npm ls", () => {
    expect(matchNpmScript("npm ls", SCRIPTS)).toBe(true);
  });

  it("allows npm list", () => {
    expect(matchNpmScript("npm list", SCRIPTS)).toBe(true);
  });

  it("allows npm view react", () => {
    expect(matchNpmScript("npm view react", SCRIPTS)).toBe(true);
  });

  it("allows npm outdated", () => {
    expect(matchNpmScript("npm outdated", SCRIPTS)).toBe(true);
  });

  it("allows npm ping", () => {
    expect(matchNpmScript("npm ping", SCRIPTS)).toBe(true);
  });

  it("allows npm root", () => {
    expect(matchNpmScript("npm root", SCRIPTS)).toBe(true);
  });

  it("allows npm prefix", () => {
    expect(matchNpmScript("npm prefix", SCRIPTS)).toBe(true);
  });

  it("allows npm config get registry", () => {
    expect(matchNpmScript("npm config get registry", SCRIPTS)).toBe(true);
  });

  it("allows pnpm list", () => {
    expect(matchNpmScript("pnpm list", SCRIPTS)).toBe(true);
  });

  it("allows yarn list", () => {
    expect(matchNpmScript("yarn list", SCRIPTS)).toBe(true);
  });

  it("allows npm why lodash", () => {
    expect(matchNpmScript("npm why lodash", SCRIPTS)).toBe(true);
  });

  it("allows pnpm why lodash", () => {
    expect(matchNpmScript("pnpm why lodash", SCRIPTS)).toBe(true);
  });
});

describe("matchNpmScript — block dangerous subcommands", () => {
  it("blocks npm run deploy (not allowlisted)", () => {
    expect(matchNpmScript("npm run deploy", SCRIPTS)).toBe(false);
  });

  it("blocks npm install", () => {
    expect(matchNpmScript("npm install", SCRIPTS)).toBe(false);
  });

  it("blocks npm i lodash", () => {
    expect(matchNpmScript("npm i lodash", SCRIPTS)).toBe(false);
  });

  it("blocks npm ci", () => {
    expect(matchNpmScript("npm ci", SCRIPTS)).toBe(false);
  });

  it("blocks npm publish", () => {
    expect(matchNpmScript("npm publish", SCRIPTS)).toBe(false);
  });

  it("blocks npm uninstall x", () => {
    expect(matchNpmScript("npm uninstall x", SCRIPTS)).toBe(false);
  });

  it("blocks yarn add lodash", () => {
    expect(matchNpmScript("yarn add lodash", SCRIPTS)).toBe(false);
  });

  it("blocks npm config set registry http://evil", () => {
    expect(matchNpmScript("npm config set registry http://evil", SCRIPTS)).toBe(false);
  });

  it("blocks npm config delete registry", () => {
    expect(matchNpmScript("npm config delete registry", SCRIPTS)).toBe(false);
  });

  it("blocks npx foo (not a package manager)", () => {
    expect(matchNpmScript("npx foo", SCRIPTS)).toBe(false);
  });

  it("blocks pnpm dlx foo", () => {
    expect(matchNpmScript("pnpm dlx foo", SCRIPTS)).toBe(false);
  });

  it("blocks npm exec foo", () => {
    expect(matchNpmScript("npm exec foo", SCRIPTS)).toBe(false);
  });

  it("blocks npm update", () => {
    expect(matchNpmScript("npm update", SCRIPTS)).toBe(false);
  });

  it("blocks npm audit fix", () => {
    expect(matchNpmScript("npm audit fix", SCRIPTS)).toBe(false);
  });

  it("blocks npm cache clean", () => {
    expect(matchNpmScript("npm cache clean", SCRIPTS)).toBe(false);
  });

  it("blocks npm version patch", () => {
    expect(matchNpmScript("npm version patch", SCRIPTS)).toBe(false);
  });

  it("blocks bare npm <script> without run keyword", () => {
    expect(matchNpmScript("npm build", SCRIPTS)).toBe(false);
  });

  it("blocks npm run with extra non-dashdash arg", () => {
    expect(matchNpmScript("npm run build extra", SCRIPTS)).toBe(false);
  });
});

describe("matchNpmScript — block operators/redirection/subshell", () => {
  it("blocks npm run build && rm -rf /", () => {
    expect(matchNpmScript("npm run build && rm -rf /", SCRIPTS)).toBe(false);
  });

  it("blocks npm run build | sh", () => {
    expect(matchNpmScript("npm run build | sh", SCRIPTS)).toBe(false);
  });

  it("blocks || operator", () => {
    expect(matchNpmScript("npm run build || npm run deploy", SCRIPTS)).toBe(false);
  });

  it("blocks ; operator", () => {
    expect(matchNpmScript("npm run build ; rm -rf /", SCRIPTS)).toBe(false);
  });

  it("blocks & background operator", () => {
    expect(matchNpmScript("npm run build & echo done", SCRIPTS)).toBe(false);
  });

  it("blocks redirection >", () => {
    expect(matchNpmScript("npm run build > out", SCRIPTS)).toBe(false);
  });

  it("blocks redirection <", () => {
    expect(matchNpmScript("npm run build < in", SCRIPTS)).toBe(false);
  });

  it("blocks subshell expansion", () => {
    expect(matchNpmScript("npm run $(echo build)", SCRIPTS)).toBe(false);
  });

  it("blocks echo before work segment", () => {
    expect(matchNpmScript("echo start && npm run build", SCRIPTS)).toBe(false);
  });

  it("blocks three-segment chain after echo", () => {
    expect(matchNpmScript("npm run build && echo ok && sh", SCRIPTS)).toBe(false);
  });
});

describe("matchNpmScript — wildcard *", () => {
  it("allows any script with *", () => {
    expect(matchNpmScript("npm run anything", ["*"])).toBe(true);
  });

  it("allows bare yarn <anyscript> with *", () => {
    expect(matchNpmScript("yarn whatever", ["*"])).toBe(true);
  });

  it("still blocks npm install with *", () => {
    expect(matchNpmScript("npm install", ["*"])).toBe(false);
  });

  it("still blocks && non-echo with *", () => {
    expect(matchNpmScript("npm run anything && rm -rf /", ["*"])).toBe(false);
  });
});

describe("matchNpmScript — empty allowlist", () => {
  it("blocks npm run build with empty allowlist", () => {
    expect(matchNpmScript("npm run build", [])).toBe(false);
  });

  it("blocks npm test with empty allowlist", () => {
    expect(matchNpmScript("npm test", [])).toBe(false);
  });

  it("still allows npm ls with empty allowlist", () => {
    expect(matchNpmScript("npm ls", [])).toBe(true);
  });

  it("still allows npm view react with empty allowlist", () => {
    expect(matchNpmScript("npm view react", [])).toBe(true);
  });

  it("still allows npm outdated with empty allowlist", () => {
    expect(matchNpmScript("npm outdated", [])).toBe(true);
  });
});

describe("matchNpmScript — workspace/dir selector flags", () => {
  it("allows pnpm -C apps/backend typecheck", () => {
    expect(matchNpmScript("pnpm -C apps/backend typecheck", SCRIPTS)).toBe(true);
  });

  it("allows pnpm --dir /repo run build", () => {
    expect(matchNpmScript("pnpm --dir /repo run build", SCRIPTS)).toBe(true);
  });

  it("allows pnpm --filter @scope/pkg test", () => {
    expect(matchNpmScript("pnpm --filter @scope/pkg test", SCRIPTS)).toBe(true);
  });

  it("allows pnpm --filter=@scope/pkg run lint (folded value)", () => {
    expect(matchNpmScript("pnpm --filter=@scope/pkg run lint", SCRIPTS)).toBe(true);
  });

  it("allows pnpm -r lint (recursive boolean flag)", () => {
    expect(matchNpmScript("pnpm -r lint", SCRIPTS)).toBe(true);
  });

  it("allows multiple selectors: pnpm --filter a --filter b test", () => {
    expect(matchNpmScript("pnpm --filter a --filter b test", SCRIPTS)).toBe(true);
  });

  it("still gates the script behind the allowlist despite selectors", () => {
    expect(matchNpmScript("pnpm --filter x run deploy", SCRIPTS)).toBe(false);
  });

  it("rejects a selector flag missing its value", () => {
    expect(matchNpmScript("pnpm --filter", SCRIPTS)).toBe(false);
  });

  it("still rejects a selector in front of install", () => {
    expect(matchNpmScript("pnpm -C /repo install", ["*"])).toBe(false);
  });
});

describe("matchNpmScript — exec delegation (gated by allowedExec)", () => {
  // The tail is approved iff isAllowed says so; these stubs stand in for the ruleset.
  const yes = () => true;
  const no = () => false;

  it("delegates the tail when the binary is opted in", () => {
    expect(matchNpmScript("pnpm exec vitest run", ["*"], ["vitest"], yes)).toBe(true);
    expect(matchNpmScript("pnpm exec vitest run", ["*"], ["vitest"], no)).toBe(false);
  });

  it("reroutes any binary under a '*' exec list (still tail-gated)", () => {
    expect(matchNpmScript("pnpm exec biome check", ["*"], ["*"], yes)).toBe(true);
    expect(matchNpmScript("pnpm exec biome check", ["*"], ["*"], no)).toBe(false);
  });

  it("does NOT reroute a binary absent from allowedExec, even if the tail is approvable", () => {
    expect(matchNpmScript("pnpm exec vitest run", ["*"], ["tsc"], yes)).toBe(false);
  });

  it("reroutes nothing when allowedExec is empty (default)", () => {
    expect(matchNpmScript("pnpm exec vitest run", ["*"], [], yes)).toBe(false);
    expect(matchNpmScript("pnpm exec vitest run", ["*"], undefined, yes)).toBe(false);
  });

  it("passes the exact tail to the evaluator", () => {
    let seen = "";
    matchNpmScript("pnpm exec tsc --noEmit", ["*"], ["tsc"], (c) => ((seen = c), true));
    expect(seen).toBe("tsc --noEmit");
  });

  it("gates on the binary basename, not a full path", () => {
    expect(
      matchNpmScript("pnpm exec ./node_modules/.bin/vitest run", ["*"], ["vitest"], yes),
    ).toBe(true);
  });

  it("strips selector flags before exec: pnpm --filter x exec vitest run", () => {
    let seen = "";
    matchNpmScript("pnpm --filter x exec vitest run", ["*"], ["vitest"], (c) => ((seen = c), true));
    expect(seen).toBe("vitest run");
  });

  it("keeps a trailing pipe with the delegated tail", () => {
    let seen = "";
    matchNpmScript("pnpm exec vitest run | tail -5", ["*"], ["vitest"], (c) => ((seen = c), true));
    expect(seen).toBe("vitest run | tail -5");
  });

  it("denies exec when no evaluator is supplied", () => {
    expect(matchNpmScript("pnpm exec vitest run", ["*"], ["*"])).toBe(false);
  });

  it("does not treat a chain as one exec unit (left to composition)", () => {
    // `&&` present → not delegated here; whole-command match fails, and even a
    // yes-evaluator must not approve the chain through this matcher.
    expect(matchNpmScript("pnpm exec vitest && rm -rf /", ["*"], ["*"], yes)).toBe(false);
  });

  it("rejects a bare exec with nothing to run", () => {
    expect(matchNpmScript("pnpm exec", ["*"], ["*"], yes)).toBe(false);
  });
});
