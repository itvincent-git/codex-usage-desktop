export function usageFailureKind(error: string | null | undefined): string | null {
  if (!error) return null;
  if (/database (?:disk image is malformed|is corrupt)|file is not a database/i.test(error)) return "cacheCorrupt";
  if (/database (?:is locked|table is locked)|database is busy/i.test(error)) return "cacheBusy";
  if (/database or disk is full|no space left on device|disk full/i.test(error)) return "diskFull";
  if (/readonly database|read-only database|unable to open database file|cache.*permission denied/i.test(error)) return "cachePermission";
  if (/failed to parse session/i.test(error)) return "sessionParseError";
  if (/failed to read session/i.test(error)) return "sessionReadError";
  return null;
}
