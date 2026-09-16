# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: babel/pi-local-native.spec.ts >> local Pi protocol double: native start, real PTY session, CLI identity and confirmed stop
- Location: packages/electron/e2e/babel/pi-local-native.spec.ts:55:5

# Error details

```
Error: page.evaluate: Error: Error invoking remote method 'set-theme': Error: No handler registered for 'set-theme'
```

# Test source

```ts
  145 |     await start.click();
  146 |     const confirmation = page.getByRole('dialog', { name: '确认开始 Pi 执行', exact: true });
  147 |     for (const text of [title, workspace, config.provider, config.model]) await expect(confirmation).toContainText(text);
  148 |     expect((await read()).latestRun).toBeNull();
  149 |     await confirmation.getByRole('button', { name: '返回', exact: true }).click();
  150 |     expect((await read()).latestRun).toBeNull();
  151 |     await start.click();
  152 |     await confirmation.getByRole('button', { name: '确认开始执行', exact: true }).click();
  153 |     await expect.poll(async () => {
  154 |       const task = await read!();
  155 |       runId = task.latestRun?.id || '';
  156 |       return task.latestRun?.status;
  157 |     }).toBe('executing');
  158 |     const started = await read();
  159 |     const sessionId = started.latestRun!.sessionId!;
  160 |     expect(sessionId).toBe('protocol-double-session');
  161 |     expect(started.latestRun!.execution).toMatchObject({ kind: 'pi', ...initial.executionTarget });
  162 |     expect(started.binding.latestRunId).toBe(runId);
  163 |     await page.getByTestId('babel-detail-tab-session').click();
  164 |     await expect(detail).toContainText(sessionId);
  165 |     await expect(detail.locator('[aria-label="当前 run 会话"]')).toContainText('你好 Pi');
  166 | 
  167 |     terminal = pty.spawn(process.execPath, ['--import', 'tsx', 'src/tui/main.ts', '--project', projectId, '--endpoint', endpoint],
  168 |       { cwd, cols: 220, rows: 48, name: 'xterm-256color', env: childEnv });
  169 |     terminal.onData((data: string) => { output += data; history += data; });
  170 |     await expect.poll(() => stripAnsi(output)).toContain('本地 Pi');
  171 |     output = '';
  172 |     terminal.write('/' + title + '\r');
  173 |     await expect.poll(() => stripAnsi(output)).toContain(title);
  174 |     output = '';
  175 |     terminal.write('F');
  176 |     await expect.poll(() => stripAnsi(output)).toContain(`记录 ${id}`);
  177 |     output = '';
  178 |     // The terminal decoder waits for another byte to disambiguate bare Escape.
  179 |     terminal.write('\x1b ');
  180 |     await expect.poll(() => stripAnsi(output)).toContain('S 查看会话输入与输出');
  181 |     output = '';
  182 |     terminal.write('S');
  183 |     for (const identity of [runId, sessionId, workspace, `${config.provider}/${config.model}`, '你好 Pi']) {
  184 |       await expect.poll(() => stripAnsi(output)).toContain(identity);
  185 |     }
  186 |     const shown = await cli<{ mode: string; run: Run }>('run', 'show', '--id', runId);
  187 |     expect(shown.mode).toBe('local');
  188 |     expect(shown.run.id).toBe(runId);
  189 |     expect(shown.run.sessionId).toBe(sessionId);
  190 | 
  191 |     previousTheme = await page.evaluate(() => (window as unknown as { electronAPI: { getTheme(): Promise<string> } }).electronAPI.getTheme());
  192 |     for (const theme of ['light', 'dark']) {
  193 |       await page.evaluate(value => (window as unknown as { electronAPI: { setTheme(value: string): Promise<void> } }).electronAPI.setTheme(value), theme);
  194 |       await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  195 |       await page.screenshot({ path: info.outputPath(`pi-protocol-${theme}.png`) });
  196 |     }
  197 | 
  198 |     output = '';
  199 |     terminal.write('m');
  200 |     await expect.poll(() => stripAnsi(output)).toContain('发送消息');
  201 |     terminal.write('finish\r');
  202 |     await expect.poll(async () => (await read!()).latestRun?.status).toBe('review_required');
  203 |     const settled = await read();
  204 |     expect(settled.latestRun!.messages.some(message => message.role === 'user' && message.text === 'finish')).toBe(true);
  205 |     await expect(detail.locator('[aria-label="当前 run 会话"]')).toContainText('你好 Pi 完整');
  206 |     await expect(controls.getByRole('button', { name: '验收完成', exact: true })).toBeDisabled();
  207 |     expect(settled.stage).not.toBe('DONE');
  208 |     expect(settled.latestRun!.verification).toEqual([]);
  209 |     expect(settled.latestRun!.diff).toBeNull();
  210 |     expect(settled.latestRun!.review).toBeNull();
  211 |     await detail.getByRole('button', { name: '请求取消', exact: true }).click();
  212 |     await expect.poll(async () => (await read!()).latestRun?.status).toBe('cancelled');
  213 |     const stopped = await read();
  214 |     expect(stopped.stage).not.toBe('DONE');
  215 |     expect(stopped.latestRun!.id).toBe(runId);
  216 |     expect(stopped.latestRun!.sessionId).toBe(sessionId);
  217 |     expect(stopped.latestRun!.review).toBeNull();
  218 |     await expect.poll(() => stripAnsi(output)).toContain('已取消');
  219 |     terminal.write('q');
  220 |     await expect.poll(() => history).toContain('\x1b[?1049l');
  221 |     writeFileSync(info.outputPath('pi-protocol-identity.json'), JSON.stringify({
  222 |       mode: 'local', evidenceKind: 'native-and-real-PTY-with-RPC-protocol-double', modelExecutionVerified: false,
  223 |       projectId, trackerId: id, runId, sessionId, workspace,
  224 |       initial, started, settled, stopped,
  225 |       verified: ['native-create', 'cancel-start-confirmation-does-not-launch', 'native-confirmed-target', 'streamed-output',
  226 |         'real-PTY-task-run-session-identity', 'PTY-message-to-same-run', 'authenticated-CLI-readback', 'native-confirmed-stop',
  227 |         'no-fake-DONE-or-verification', 'light-dark-native-screenshots', 'PTY-alternate-screen-restored'],
  228 |       notVerified: ['real-provider-or-model-call', 'real-tool-edit', 'real-diff-and-test-evidence', 'independent-acceptance-session'],
  229 |     }, null, 2));
  230 |   } finally {
  231 |     writeFileSync(info.outputPath('pi-protocol-pty.txt'), redact(history));
  232 |     terminal?.kill();
  233 |     // Stop only the run created here if an assertion interrupted the flow.
  234 |     if (runId && read) {
  235 |       try {
  236 |         const task = await read();
  237 |         if (['requested', 'accepted', 'executing', 'review_required', 'cancel_requested'].includes(task.latestRun?.status || '')) {
  238 |           await cli('run', 'cancel', '--id', runId, '--idempotency-key', `cleanup-${runId}`);
  239 |         }
  240 |       } catch (error) {
  241 |         writeFileSync(info.outputPath('pi-protocol-cleanup-error.txt'), redact(String(error)));
  242 |       }
  243 |     }
  244 |     if (page && previousTheme) {
> 245 |       await page.evaluate(value => (window as unknown as { electronAPI: { setTheme(value: string): Promise<void> } }).electronAPI.setTheme(value), previousTheme);
      |                  ^ Error: page.evaluate: Error: Error invoking remote method 'set-theme': Error: No handler registered for 'set-theme'
  246 |     }
  247 |     await browser.close();
  248 |   }
  249 | });
  250 | 
```