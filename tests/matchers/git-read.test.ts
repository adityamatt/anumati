import { describe, it, expect } from "vitest";
import { matchGitRead } from "../../src/matchers/git-read.js";

describe("matchGitRead — allow basic read subcommands", () => {
  it("git status", () => {
    expect(matchGitRead("git status")).toBe(true);
  });

  it("git log --oneline -5", () => {
    expect(matchGitRead("git log --oneline -5")).toBe(true);
  });

  it("git diff HEAD~1", () => {
    expect(matchGitRead("git diff HEAD~1")).toBe(true);
  });

  it("git show abc123", () => {
    expect(matchGitRead("git show abc123")).toBe(true);
  });

  it("git rev-parse HEAD", () => {
    expect(matchGitRead("git rev-parse HEAD")).toBe(true);
  });

  it("git blame file.ts", () => {
    expect(matchGitRead("git blame file.ts")).toBe(true);
  });

  it("git ls-files", () => {
    expect(matchGitRead("git ls-files")).toBe(true);
  });

  it("git describe", () => {
    expect(matchGitRead("git describe")).toBe(true);
  });

  it("git shortlog", () => {
    expect(matchGitRead("git shortlog")).toBe(true);
  });

  it("git for-each-ref", () => {
    expect(matchGitRead("git for-each-ref")).toBe(true);
  });

  it("git merge-base main HEAD", () => {
    expect(matchGitRead("git merge-base main HEAD")).toBe(true);
  });
});

describe("matchGitRead — branch", () => {
  it("plain git branch", () => {
    expect(matchGitRead("git branch")).toBe(true);
  });

  it("git branch -a", () => {
    expect(matchGitRead("git branch -a")).toBe(true);
  });

  it("git branch -r", () => {
    expect(matchGitRead("git branch -r")).toBe(true);
  });

  it("git branch --list", () => {
    expect(matchGitRead("git branch --list")).toBe(true);
  });

  it("git branch -v", () => {
    expect(matchGitRead("git branch -v")).toBe(true);
  });

  it("blocks git branch -d", () => {
    expect(matchGitRead("git branch -d feature")).toBe(false);
  });

  it("blocks git branch -D main", () => {
    expect(matchGitRead("git branch -D main")).toBe(false);
  });

  it("blocks git branch -m", () => {
    expect(matchGitRead("git branch -m old new")).toBe(false);
  });

  it("blocks git branch -f", () => {
    expect(matchGitRead("git branch -f feature HEAD")).toBe(false);
  });

  it("blocks git branch --set-upstream-to", () => {
    expect(matchGitRead("git branch --set-upstream-to=origin/main")).toBe(false);
  });

  it("blocks unknown branch flag", () => {
    expect(matchGitRead("git branch --edit-description")).toBe(false);
  });
});

describe("matchGitRead — config", () => {
  it("git config --get user.name", () => {
    expect(matchGitRead("git config --get user.name")).toBe(true);
  });

  it("git config --list", () => {
    expect(matchGitRead("git config --list")).toBe(true);
  });

  it("git config -l", () => {
    expect(matchGitRead("git config -l")).toBe(true);
  });

  it("git config --get-all", () => {
    expect(matchGitRead("git config --get-all remote.origin.url")).toBe(true);
  });

  it("git config --get-regexp", () => {
    expect(matchGitRead("git config --get-regexp ^user")).toBe(true);
  });

  it("blocks bare git config key value (set)", () => {
    expect(matchGitRead("git config user.name evil")).toBe(false);
  });

  it("blocks --add", () => {
    expect(matchGitRead("git config --add user.name evil")).toBe(false);
  });

  it("blocks --unset", () => {
    expect(matchGitRead("git config --unset user.name")).toBe(false);
  });

  it("blocks --replace-all", () => {
    expect(matchGitRead("git config --replace-all user.name evil")).toBe(false);
  });

  it("blocks -e (edit)", () => {
    expect(matchGitRead("git config -e")).toBe(false);
  });

  it("blocks --remove-section", () => {
    expect(matchGitRead("git config --remove-section user")).toBe(false);
  });
});

describe("matchGitRead — stash", () => {
  it("git stash list", () => {
    expect(matchGitRead("git stash list")).toBe(true);
  });

  it("git stash show", () => {
    expect(matchGitRead("git stash show")).toBe(true);
  });

  it("blocks bare git stash (push)", () => {
    expect(matchGitRead("git stash")).toBe(false);
  });

  it("blocks git stash pop", () => {
    expect(matchGitRead("git stash pop")).toBe(false);
  });

  it("blocks git stash drop", () => {
    expect(matchGitRead("git stash drop")).toBe(false);
  });

  it("blocks git stash clear", () => {
    expect(matchGitRead("git stash clear")).toBe(false);
  });

  it("blocks git stash apply", () => {
    expect(matchGitRead("git stash apply")).toBe(false);
  });
});

describe("matchGitRead — remote", () => {
  it("git remote", () => {
    expect(matchGitRead("git remote")).toBe(true);
  });

  it("git remote -v", () => {
    expect(matchGitRead("git remote -v")).toBe(true);
  });

  it("git remote show origin", () => {
    expect(matchGitRead("git remote show origin")).toBe(true);
  });

  it("git remote get-url origin", () => {
    expect(matchGitRead("git remote get-url origin")).toBe(true);
  });

  it("blocks git remote add", () => {
    expect(matchGitRead("git remote add origin https://example.com/x.git")).toBe(false);
  });

  it("blocks git remote remove", () => {
    expect(matchGitRead("git remote remove origin")).toBe(false);
  });

  it("blocks git remote set-url", () => {
    expect(matchGitRead("git remote set-url origin https://evil.com")).toBe(false);
  });

  it("blocks git remote prune", () => {
    expect(matchGitRead("git remote prune origin")).toBe(false);
  });
});

describe("matchGitRead — tag", () => {
  it("git tag (list)", () => {
    expect(matchGitRead("git tag")).toBe(true);
  });

  it("git tag -l", () => {
    expect(matchGitRead("git tag -l")).toBe(true);
  });

  it("git tag --list v1*", () => {
    expect(matchGitRead("git tag --list v1*")).toBe(true);
  });

  it("blocks git tag -d v1", () => {
    expect(matchGitRead("git tag -d v1")).toBe(false);
  });

  it("blocks git tag -a", () => {
    expect(matchGitRead("git tag -a v1 -m msg")).toBe(false);
  });

  it("blocks creating tag (bare name)", () => {
    expect(matchGitRead("git tag v1.0.0")).toBe(false);
  });
});

describe("matchGitRead — reflog", () => {
  it("git reflog", () => {
    expect(matchGitRead("git reflog")).toBe(true);
  });

  it("git reflog show", () => {
    expect(matchGitRead("git reflog show")).toBe(true);
  });

  it("blocks git reflog delete", () => {
    expect(matchGitRead("git reflog delete HEAD@{0}")).toBe(false);
  });

  it("blocks git reflog expire", () => {
    expect(matchGitRead("git reflog expire --all")).toBe(false);
  });
});

describe("matchGitRead — global options", () => {
  it("allows -C <dir>", () => {
    expect(matchGitRead("git -C /tmp/repo status")).toBe(true);
  });

  it("allows --no-pager", () => {
    expect(matchGitRead("git --no-pager log")).toBe(true);
  });

  it("blocks -c key=val", () => {
    expect(matchGitRead("git -c core.pager=cat log")).toBe(false);
  });
});

describe("matchGitRead — pipes", () => {
  it("git log | head -20", () => {
    expect(matchGitRead("git log | head -20")).toBe(true);
  });

  it("git diff | grep foo", () => {
    expect(matchGitRead("git diff | grep foo")).toBe(true);
  });

  it("git log | grep foo | head -5", () => {
    expect(matchGitRead("git log | grep foo | head -5")).toBe(true);
  });

  it("git log | jq (shared consumer set now includes jq)", () => {
    expect(matchGitRead("git log --format=%H | jq -R .")).toBe(true);
  });

  it("blocks pipe to sh", () => {
    expect(matchGitRead("git log | sh")).toBe(false);
  });

  it("blocks pipe to xargs", () => {
    expect(matchGitRead("git log | xargs rm")).toBe(false);
  });

  it("blocks pipe to sed", () => {
    expect(matchGitRead("git log | sed s/a/b/")).toBe(false);
  });

  it("blocks pipe to awk", () => {
    expect(matchGitRead("git log | awk '{print}'")).toBe(false);
  });

  it("blocks pipe to tee", () => {
    expect(matchGitRead("git log | tee out.txt")).toBe(false);
  });

  it("blocks first segment not git", () => {
    expect(matchGitRead("cat /etc/passwd | grep root")).toBe(false);
  });
});

describe("matchGitRead — worktree (list only)", () => {
  it("allows git worktree list", () => {
    expect(matchGitRead("git worktree list")).toBe(true);
  });
  it("blocks git worktree add (a write)", () => {
    expect(matchGitRead("git worktree add ../x")).toBe(false);
  });
  it("blocks git worktree remove", () => {
    expect(matchGitRead("git worktree remove ../x")).toBe(false);
  });
  it("blocks bare git worktree", () => {
    expect(matchGitRead("git worktree")).toBe(false);
  });
});

describe("matchGitRead — block mutating subcommands", () => {
  it("git push", () => {
    expect(matchGitRead("git push")).toBe(false);
  });

  it("git commit -m x", () => {
    expect(matchGitRead("git commit -m x")).toBe(false);
  });

  it("git pull", () => {
    expect(matchGitRead("git pull")).toBe(false);
  });

  it("git fetch", () => {
    expect(matchGitRead("git fetch")).toBe(false);
  });

  it("git checkout .", () => {
    expect(matchGitRead("git checkout .")).toBe(false);
  });

  it("git switch main", () => {
    expect(matchGitRead("git switch main")).toBe(false);
  });

  it("git reset --hard", () => {
    expect(matchGitRead("git reset --hard")).toBe(false);
  });

  it("git rebase main", () => {
    expect(matchGitRead("git rebase main")).toBe(false);
  });

  it("git merge feature", () => {
    expect(matchGitRead("git merge feature")).toBe(false);
  });

  it("git clean -fd", () => {
    expect(matchGitRead("git clean -fd")).toBe(false);
  });

  it("git add .", () => {
    expect(matchGitRead("git add .")).toBe(false);
  });

  it("git rm file", () => {
    expect(matchGitRead("git rm file")).toBe(false);
  });

  it("git restore file", () => {
    expect(matchGitRead("git restore file")).toBe(false);
  });

  it("git clone url", () => {
    expect(matchGitRead("git clone https://example.com/x.git")).toBe(false);
  });

  it("git init", () => {
    expect(matchGitRead("git init")).toBe(false);
  });

  it("git worktree add", () => {
    expect(matchGitRead("git worktree add ../wt")).toBe(false);
  });

  it("git gc", () => {
    expect(matchGitRead("git gc")).toBe(false);
  });

  it("git fsck", () => {
    expect(matchGitRead("git fsck")).toBe(false);
  });
});

describe("matchGitRead — block operators and redirection", () => {
  it("git status && rm -rf /", () => {
    expect(matchGitRead("git status && rm -rf /")).toBe(false);
  });

  it("git status; rm x", () => {
    expect(matchGitRead("git status; rm x")).toBe(false);
  });

  it("git status || echo fail", () => {
    expect(matchGitRead("git status || echo fail")).toBe(false);
  });

  it("git status &", () => {
    expect(matchGitRead("git status &")).toBe(false);
  });

  it("git log > out.txt", () => {
    expect(matchGitRead("git log > out.txt")).toBe(false);
  });

  it("git log >> out.txt", () => {
    expect(matchGitRead("git log >> out.txt")).toBe(false);
  });

  it("git diff < input", () => {
    expect(matchGitRead("git diff < input")).toBe(false);
  });

  it("git log | head > out.txt", () => {
    expect(matchGitRead("git log | head > out.txt")).toBe(false);
  });
});

describe("matchGitRead — block dangerous chars / non-git", () => {
  it("subshell expansion git log $(...)", () => {
    expect(matchGitRead("git log $(rm -rf /)")).toBe(false);
  });

  it("backtick expansion", () => {
    expect(matchGitRead("git log `whoami`")).toBe(false);
  });

  it("not git at all", () => {
    expect(matchGitRead("ls -la")).toBe(false);
  });

  it("empty command", () => {
    expect(matchGitRead("")).toBe(false);
  });

  it("git with no subcommand", () => {
    expect(matchGitRead("git")).toBe(false);
  });
});
