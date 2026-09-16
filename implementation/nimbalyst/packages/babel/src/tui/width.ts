/** East Asian Width / CJK: wide = 2, combining = 0, else 1. Never split a wide glyph. */

export function codeWidth(code: number): number {
  if (code === 0) return 0;
  if (code < 32 || (code >= 0x7f && code < 0xa0)) return 0;
  if (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  ) {
    return 0;
  }
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    code === 0x2329 ||
    code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += codeWidth(ch.codePointAt(0) ?? 0);
  return width;
}

export function sliceByWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  let width = 0;
  let out = "";
  for (const ch of text) {
    const w = codeWidth(ch.codePointAt(0) ?? 0);
    if (width + w > maxWidth) break;
    out += ch;
    width += w;
  }
  return out;
}

export function padWidth(text: string, width: number, align: "left" | "right" = "left"): string {
  const clipped = sliceByWidth(text, width);
  const pad = Math.max(0, width - displayWidth(clipped));
  const spaces = " ".repeat(pad);
  return align === "right" ? spaces + clipped : clipped + spaces;
}

export function wrapByWidth(text: string, width: number, maxLines = 40): string[] {
  if (width <= 0) return [];
  const lines: string[] = [];
  const source = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (const raw of source.split("\n")) {
    if (raw.length === 0) {
      lines.push("");
      if (lines.length >= maxLines) return lines;
      continue;
    }
    let rest = raw;
    while (rest.length > 0 && lines.length < maxLines) {
      const piece = sliceByWidth(rest, width);
      lines.push(piece);
      rest = rest.slice(piece.length);
    }
    if (lines.length >= maxLines) break;
  }
  return lines;
}
