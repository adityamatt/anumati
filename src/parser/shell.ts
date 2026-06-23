type QuoteState = "normal" | "single" | "double";

export interface Segment {
  raw: string;
  operator: "|" | "&&" | "||" | ";" | "&" | null;
}

const DANGEROUS = /[`$]/;

export function parseCompound(command: string): Segment[] | null {
  if (DANGEROUS.test(command)) return null;

  const segments: Segment[] = [];
  let segStart = 0;
  let state: QuoteState = "normal";
  let i = 0;

  const push = (end: number, op: Segment["operator"], skip: number) => {
    const raw = command.slice(segStart, end).trim();
    if (raw) segments.push({ raw, operator: op });
    segStart = end + skip;
  };

  while (i < command.length) {
    const ch = command[i];
    const next = command[i + 1] ?? "";

    if (state === "single") {
      if (ch === "'") state = "normal";
    } else if (state === "double") {
      if (ch === '"') state = "normal";
      else if (ch === "\\" && next === '"') i++;
    } else {
      if (ch === "'") { state = "single"; }
      else if (ch === '"') { state = "double"; }
      else if (ch === "|" && next === "|") { push(i, "||", 2); i++; }
      else if (ch === "&" && next === "&") { push(i, "&&", 2); i++; }
      else if (ch === "|") { push(i, "|", 1); }
      else if (ch === ";") { push(i, ";", 1); }
      else if (ch === "&")  { push(i, "&", 1); }
    }
    i++;
  }

  if (state !== "normal") return null; // unclosed quote

  const last = command.slice(segStart).trim();
  if (last) segments.push({ raw: last, operator: null });

  return segments.length > 0 ? segments : null;
}

export function tokenize(raw: string): string[] | null {
  if (DANGEROUS.test(raw)) return null;

  const tokens: string[] = [];
  let current = "";
  let state: QuoteState = "normal";

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1] ?? "";

    if (state === "single") {
      if (ch === "'") state = "normal";
      else current += ch;
    } else if (state === "double") {
      if (ch === '"') state = "normal";
      else if (ch === "\\" && next === '"') { current += '"'; i++; }
      else current += ch;
    } else {
      if (ch === "'") { state = "single"; }
      else if (ch === '"') { state = "double"; }
      else if (ch === " " || ch === "\t") {
        if (current) { tokens.push(current); current = ""; }
      } else {
        current += ch;
      }
    }
  }

  if (state !== "normal") return null;
  if (current) tokens.push(current);
  return tokens.length > 0 ? tokens : null;
}
