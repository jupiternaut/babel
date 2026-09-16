export type KeyEvent =
  | { type: "key"; name: string; raw: string; ctrl: boolean; shift: boolean }
  | { type: "text"; text: string }
  | { type: "paste"; text: string }
  | { type: "mouse"; kind: "down" | "up" | "drag" | "wheel"; button: number; x: number; y: number; wheel: -1 | 0 | 1 };

const NAMED: Record<string, string> = {
  "\x1b[A": "up",
  "\x1b[B": "down",
  "\x1b[C": "right",
  "\x1b[D": "left",
  "\x1b[H": "home",
  "\x1b[F": "end",
  "\x1b[1~": "home",
  "\x1b[4~": "end",
  "\x1b[3~": "delete",
  "\x1b[5~": "pageup",
  "\x1b[6~": "pagedown",
  "\x1b[Z": "tab",
  "\x1bOP": "f1",
  "\x1bOQ": "f2",
  "\x1bOR": "f3",
  "\x1bOS": "f4",
  "\r": "enter",
  "\n": "enter",
  "\t": "tab",
  "\x7f": "backspace",
  "\x08": "backspace",
  "\x1b": "escape",
};

export class InputDecoder {
  private buffer = "";
  private pasting = false;
  private pasteBuf = "";

  get hasPendingEscape(): boolean {
    return !this.pasting && this.buffer === "\x1b";
  }

  flushEscape(): KeyEvent[] {
    if (!this.hasPendingEscape) return [];
    this.buffer = "";
    return [{ type: "key", name: "escape", raw: "\x1b", ctrl: false, shift: false }];
  }

  push(chunk: string): KeyEvent[] {
    this.buffer += chunk;
    const events: KeyEvent[] = [];
    while (this.buffer.length > 0) {
      const ev = this.next();
      if (!ev) break;
      if (ev === "need-more") break;
      events.push(ev);
    }
    return events;
  }

  private next(): KeyEvent | "need-more" | null {
    if (!this.buffer) return null;
    if (!this.pasting && this.buffer.startsWith("\x1b[200~")) {
      this.buffer = this.buffer.slice(6);
      this.pasting = true;
      this.pasteBuf = "";
      return this.next();
    }
    if (this.pasting) {
      const end = this.buffer.indexOf("\x1b[201~");
      if (end === -1) {
        // Keep a fragmented closing delimiter until the next input chunk.
        let keep = Math.min(5, this.buffer.length);
        while (keep > 0 && !"\x1b[201~".startsWith(this.buffer.slice(-keep))) keep--;
        this.pasteBuf += this.buffer.slice(0, this.buffer.length - keep);
        this.buffer = this.buffer.slice(this.buffer.length - keep);
        return "need-more";
      }
      this.pasteBuf += this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 6);
      this.pasting = false;
      const text = this.pasteBuf;
      this.pasteBuf = "";
      return { type: "paste", text };
    }
    if (this.buffer.startsWith("\x1b[<")) {
      const m = this.buffer.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (!m) return this.buffer.length > 32 ? this.dropOne() : "need-more";
      this.buffer = this.buffer.slice(m[0].length);
      const btn = Number(m[1]);
      const x = Number(m[2]);
      const y = Number(m[3]);
      const down = m[4] === "M";
      const motion = (btn & 32) !== 0;
      const wheel = (btn & 64) !== 0;
      if (wheel) {
        return { type: "mouse", kind: "wheel", button: btn, x, y, wheel: (btn & 1) === 1 ? 1 : -1 };
      }
      if (motion) {
        return { type: "mouse", kind: "drag", button: btn & 3, x, y, wheel: 0 };
      }
      return { type: "mouse", kind: down ? "down" : "up", button: btn & 3, x, y, wheel: 0 };
    }
    if (this.buffer.startsWith("\x1b[M")) {
      if (this.buffer.length < 6) return "need-more";
      const b = this.buffer.charCodeAt(3) - 32;
      const x = this.buffer.charCodeAt(4) - 32;
      const y = this.buffer.charCodeAt(5) - 32;
      this.buffer = this.buffer.slice(6);
      if ((b & 64) !== 0) {
        return { type: "mouse", kind: "wheel", button: b, x, y, wheel: (b & 1) === 1 ? 1 : -1 };
      }
      return { type: "mouse", kind: "down", button: b & 3, x, y, wheel: 0 };
    }
    if (this.buffer[0] === "\x1b") {
      if (this.buffer.length === 1) return "need-more";
      for (const [seq, name] of Object.entries(NAMED)) {
        if (seq.length > 1 && this.buffer.startsWith(seq) && seq.startsWith("\x1b")) {
          this.buffer = this.buffer.slice(seq.length);
          return { type: "key", name, raw: seq, ctrl: false, shift: name === "tab" && seq === "\x1b[Z" };
        }
      }
      if ([...Object.keys(NAMED), "\x1b[200~", "\x1b[M"].some(seq => seq.startsWith(this.buffer))) {
        return "need-more";
      }
      const csi = this.buffer.match(/^\x1b\[[0-9;?]*[A-Za-z~]/);
      if (csi) {
        this.buffer = this.buffer.slice(csi[0].length);
        const mapped = NAMED[csi[0]];
        return { type: "key", name: mapped ?? "unknown", raw: csi[0], ctrl: false, shift: false };
      }
      if (this.buffer.length >= 2 && this.buffer[1] !== "[") {
        const raw = this.buffer.slice(0, 1);
        this.buffer = this.buffer.slice(1);
        return { type: "key", name: "escape", raw, ctrl: false, shift: false };
      }
      return this.buffer.length > 16 ? this.dropOne() : "need-more";
    }
    const ch = this.buffer[0] ?? "";
    if (ch === "\x03") {
      this.buffer = this.buffer.slice(1);
      return { type: "key", name: "ctrl-c", raw: ch, ctrl: true, shift: false };
    }
    if (ch === "\x13") {
      this.buffer = this.buffer.slice(1);
      return { type: "key", name: "ctrl-s", raw: ch, ctrl: true, shift: false };
    }
    if (NAMED[ch]) {
      this.buffer = this.buffer.slice(1);
      return { type: "key", name: NAMED[ch], raw: ch, ctrl: false, shift: false };
    }
    if (ch.charCodeAt(0) < 32) {
      this.buffer = this.buffer.slice(1);
      return { type: "key", name: `ctrl-${String.fromCharCode(ch.charCodeAt(0) + 96)}`, raw: ch, ctrl: true, shift: false };
    }
    const match = this.buffer.match(/^(?:\p{L}|\p{N}|\p{P}|\p{S}|\p{Zs}|.)/u);
    const text = match?.[0] ?? ch;
    this.buffer = this.buffer.slice(text.length);
    return { type: "text", text };
  }

  private dropOne(): KeyEvent {
    const raw = this.buffer[0] ?? "";
    this.buffer = this.buffer.slice(1);
    return { type: "key", name: "unknown", raw, ctrl: false, shift: false };
  }
}
