export class MockSshSession {
  connected: boolean;

  constructor(connected = true) {
    this.connected = connected;
  }

  disconnect(): void {
    this.connected = false;
  }

  reconnect(): void {
    this.connected = true;
  }
}
