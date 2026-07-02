export type CommandKind =
  | "curl"
  | "git"
  | "gh-api"
  | "safe-builtin"
  | "python3-c"
  | "python3-script"
  | "nodejs-e"
  | "nodejs-script"
  | "dangerous"
  | "unknown";

export interface ClassifiedCommand {
  kind: CommandKind;
  argv: string[];
  raw: string;
}
