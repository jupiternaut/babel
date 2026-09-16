#!/usr/bin/env node
// Protocol double only: never imports Pi or calls a provider/model.
import { createInterface } from 'node:readline';
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
writeFileSync('fixture-start.json', JSON.stringify({ pid: process.pid, argv: process.argv.slice(2), env: process.env }));
let busy = false;
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n');
const state = () => ({ sessionId: 'protocol-double-session', sessionFile: arg('--session'),
  model: { provider: arg('--provider'), id: arg('--model') },
  isStreaming: arg('--model') === 'invalid-state' || busy, isCompacting: false, messageCount: 0, pendingMessageCount: 0 });
const start = () => {
  busy = true;
  send({ type: 'agent_start' });
  send({ type: 'message_start', message: { role: 'assistant', content: [] } });
  send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: '你好' } });
  send({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' Pi' } });
};
const finish = (error = false) => {
  const message = { role: 'assistant', content: [{ type: 'text', text: '你好 Pi 完整' }],
    stopReason: error ? 'error' : 'stop', ...(error ? { errorMessage: 'provider fixture error' } : {}) };
  send({ type: 'message_end', message });
  send({ type: 'agent_end', messages: [message], willRetry: false });
  busy = false;
  send({ type: 'agent_settled' });
};
createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  appendFileSync('fixture-commands.jsonl', JSON.stringify(command) + '\n');
  if (command.message === 'reject') {
    send({ type: 'response', id: command.id, command: command.type, success: false, error: 'fixture rejected' });
    return;
  }
  if (command.message === 'timeout') return;
  send({ type: 'response', id: command.id, command: command.type, success: true,
    ...(command.type === 'get_state' ? { data: state() } : {}) });
  if (command.type === 'prompt') {
    start();
    if (command.message === 'stream') {
      send({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'bash', args: { command: 'fixture-only' } });
      send({ type: 'tool_execution_update', toolCallId: 'call-1', toolName: 'bash', partialResult: { content: [{ type: 'text', text: 'partial' }] } });
      send({ type: 'tool_execution_end', toolCallId: 'call-1', toolName: 'bash', result: { content: [{ type: 'text', text: 'complete' }] }, isError: false });
      finish();
    } else if (command.message === 'error') finish(true);
    else if (command.message === 'disconnect') process.stdout.end();
    else if (command.message === 'descendant') {
      process.on('SIGTERM', () => {});
      const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      writeFileSync('fixture-descendant.json', JSON.stringify({ pid: child.pid }));
    } else if (command.message === 'end-without-settled') {
      busy = false;
      send({ type: 'agent_end', messages: [], willRetry: false });
    }
  } else if (command.type === 'steer' && command.message === 'finish') finish();
});
