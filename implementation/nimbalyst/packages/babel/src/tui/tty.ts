import { stdin, stdout } from "node:process";

const ENTER_ALT = "\x1b[?1049h";
const LEAVE_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const MOUSE_ON = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1006l\x1b[?1002l\x1b[?1000l";
const PASTE_ON = "\x1b[?2004h";
const PASTE_OFF = "\x1b[?2004l";
const CLEAR = "\x1b[2J\x1b[H";

export class TtySession {
  private restored = false;
  private readonly onSigint: () => void;
  private readonly onExit: () => void;

  constructor(private readonly onQuit: () => void) {
    this.onSigint = () => this.onQuit();
    this.onExit = () => this.restore();
  }

  enter(): void {
    if (!stdin.isTTY || !stdout.isTTY) {
      throw new Error("NOT_TTY");
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdout.write(ENTER_ALT + HIDE_CURSOR + MOUSE_ON + PASTE_ON + CLEAR);
    process.on("SIGINT", this.onSigint);
    process.on("SIGTERM", this.onSigint);
    process.on("exit", this.onExit);
  }

  write(text: string): void {
    stdout.write(text);
  }

  showCursor(show: boolean): void {
    stdout.write(show ? SHOW_CURSOR : HIDE_CURSOR);
  }

  restore(): void {
    if (this.restored) return;
    this.restored = true;
    try {
      stdout.write(PASTE_OFF + MOUSE_OFF + SHOW_CURSOR + LEAVE_ALT);
    } catch {
      // ignore broken pipe on exit
    }
    try {
      if (stdin.isTTY) stdin.setRawMode(false);
    } catch {
      // ignore
    }
    process.off("SIGINT", this.onSigint);
    process.off("SIGTERM", this.onSigint);
    process.off("exit", this.onExit);
  }
}

export function terminalSize(): { cols: number; rows: number } {
  return {
    cols: stdout.columns && stdout.columns > 0 ? stdout.columns : 80,
    rows: stdout.rows && stdout.rows > 0 ? stdout.rows : 24,
  };
}
