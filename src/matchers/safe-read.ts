import path from "path";

export function matchSafeRead(filePath: string): boolean {
  if (!filePath) return false;
  const parts = filePath.split(path.sep);
  return !parts.includes("..");
}
