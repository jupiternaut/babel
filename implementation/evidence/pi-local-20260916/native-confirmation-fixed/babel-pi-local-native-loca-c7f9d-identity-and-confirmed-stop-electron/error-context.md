# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: babel/pi-local-native.spec.ts >> local Pi protocol double: native start, real PTY session, CLI identity and confirmed stop
- Location: packages/electron/e2e/babel/pi-local-native.spec.ts:55:5

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "cancelled"
Received: "cancel_requested"

Call Log:
- Timeout 10000ms exceeded while waiting on the predicate
```

# Test source

```ts
  115 |     const attention = page.getByTestId('babel-attention-toggle');
  116 |     if (await attention.getAttribute('aria-pressed') === 'true') await attention.click();
  117 |     await page.setViewportSize({ width: 1500, height: 1000 });
  118 |     const todo = page.getByTestId('babel-stage-tab-TODO');
  119 |     if (await todo.isVisible()) await todo.click();
  120 | 
  121 |     const title = `Pi 协议测试（不调用模型）-${Date.now()}`;
  122 |     await page.getByTestId('babel-execution-create-todo').click();
  123 |     await page.getByPlaceholder('New task...').fill(title);
  124 |     await page.getByRole('button', { name: 'Add', exact: true }).click();
  125 |     await expect.poll(async () => {
  126 |       const listed = await cli<{ mode: string; items: Array<{ trackerId: string; title: string }> }>('task', 'list');
  127 |       expect(listed.mode).toBe('local');
  128 |       const exact = listed.items.filter(item => item.title === title);
  129 |       expect(exact.length).toBeLessThanOrEqual(1);
  130 |       id = exact[0]?.trackerId || '';
  131 |       return id;
  132 |     }).not.toBe('');
  133 |     read = () => cli<Task>('task', 'get', '--id', id);
  134 |     const initial = await read();
  135 |     expect(initial.record.fields.title).toBe(title);
  136 |     expect(initial.mode).toBe('local');
  137 |     expect(initial.executionTarget).toEqual({ workdir: workspace, provider: config.provider, model: config.model });
  138 |     expect(initial.latestRun).toBeNull();
  139 |     await page.locator(`[data-tracker-id="${id}"]`).getByRole('button').first().click();
  140 |     const detail = page.getByTestId('babel-execution-detail');
  141 |     await expect(detail).toContainText('本机 Pi');
  142 |     const controls = detail.getByTestId('babel-run-controls');
  143 |     const start = controls.getByRole('button', { name: '开始执行', exact: true });
  144 |     await start.click();
  145 |     const confirmation = page.getByRole('dialog', { name: '确认开始 Pi 执行', exact: true });
  146 |     for (const text of [title, workspace, config.provider, config.model]) await expect(confirmation).toContainText(text);
  147 |     expect((await read()).latestRun).toBeNull();
  148 |     await confirmation.getByRole('button', { name: '返回', exact: true }).click();
  149 |     expect((await read()).latestRun).toBeNull();
  150 |     await start.click();
  151 |     await confirmation.getByRole('button', { name: '确认开始执行', exact: true }).click();
  152 |     await expect.poll(async () => {
  153 |       const task = await read!();
  154 |       runId = task.latestRun?.id || '';
  155 |       return task.latestRun?.status;
  156 |     }).toBe('executing');
  157 |     const started = await read();
  158 |     const sessionId = started.latestRun!.sessionId!;
  159 |     expect(sessionId).toBe('protocol-double-session');
  160 |     expect(started.latestRun!.execution).toMatchObject({ kind: 'pi', ...initial.executionTarget });
  161 |     expect(started.binding.latestRunId).toBe(runId);
  162 |     await page.getByTestId('babel-detail-tab-session').click();
  163 |     await expect(detail).toContainText(sessionId);
  164 |     await expect(detail.locator('[aria-label="当前 run 会话"]')).toContainText('你好 Pi');
  165 | 
  166 |     terminal = pty.spawn(process.execPath, ['--import', 'tsx', 'src/tui/main.ts', '--project', projectId, '--endpoint', endpoint],
  167 |       { cwd, cols: 220, rows: 48, name: 'xterm-256color', env: childEnv });
  168 |     terminal.onData((data: string) => { output += data; history += data; });
  169 |     await expect.poll(() => stripAnsi(output)).toContain('本地 Pi');
  170 |     output = '';
  171 |     terminal.write('/' + title + '\r');
  172 |     await expect.poll(() => stripAnsi(output)).toContain(title);
  173 |     output = '';
  174 |     terminal.write('F');
  175 |     await expect.poll(() => stripAnsi(output)).toContain(`记录 ${id}`);
  176 |     output = '';
  177 |     // The terminal decoder waits for another byte to disambiguate bare Escape.
  178 |     terminal.write('\x1b ');
  179 |     await expect.poll(() => stripAnsi(output)).toContain('S 查看会话输入与输出');
  180 |     output = '';
  181 |     terminal.write('S');
  182 |     for (const identity of [runId, sessionId, workspace, `${config.provider}/${config.model}`, '你好 Pi']) {
  183 |       await expect.poll(() => stripAnsi(output)).toContain(identity);
  184 |     }
  185 |     const shown = await cli<{ mode: string; run: Run }>('run', 'show', '--id', runId);
  186 |     expect(shown.mode).toBe('local');
  187 |     expect(shown.run.id).toBe(runId);
  188 |     expect(shown.run.sessionId).toBe(sessionId);
  189 |     await detail.getByLabel('补充消息（发给当前执行，不是任务讨论）').fill('来自 GUI 的补充消息');
  190 |     await detail.getByRole('button', { name: '发送补充消息', exact: true }).click();
  191 |     await expect.poll(async () => (await read!()).latestRun!.messages.filter(message => message.role === 'user' && message.text === '来自 GUI 的补充消息').length).toBe(1);
  192 |     await expect(detail.getByLabel('补充消息（发给当前执行，不是任务讨论）')).toHaveValue('');
  193 | 
  194 |     for (const theme of ['light', 'dark']) {
  195 |       await page.getByRole('button', { name: 'Change theme', exact: true }).click();
  196 |       await page.getByRole('menu', { name: 'Theme selection' }).getByText(theme === 'light' ? 'Light' : 'Dark', { exact: true }).click();
  197 |       await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  198 |       await page.screenshot({ path: info.outputPath(`pi-protocol-${theme}.png`) });
  199 |     }
  200 | 
  201 |     output = '';
  202 |     terminal.write('m');
  203 |     await expect.poll(() => stripAnsi(output)).toContain('发送消息');
  204 |     terminal.write('finish\r');
  205 |     await expect.poll(async () => (await read!()).latestRun?.status).toBe('review_required');
  206 |     const settled = await read();
  207 |     expect(settled.latestRun!.messages.some(message => message.role === 'user' && message.text === 'finish')).toBe(true);
  208 |     await expect(detail.locator('[aria-label="当前 run 会话"]')).toContainText('你好 Pi 完整');
  209 |     await expect(controls.getByRole('button', { name: '验收完成', exact: true })).toBeDisabled();
  210 |     expect(settled.stage).not.toBe('DONE');
  211 |     expect(settled.latestRun!.verification).toEqual([]);
  212 |     expect(settled.latestRun!.diff).toBeNull();
  213 |     expect(settled.latestRun!.review).toBeNull();
  214 |     await detail.getByRole('button', { name: '请求取消', exact: true }).click();
> 215 |     await expect.poll(async () => (await read!()).latestRun?.status).toBe('cancelled');
      |     ^ Error: expect(received).toBe(expected) // Object.is equality
  216 |     const stopped = await read();
  217 |     expect(stopped.stage).not.toBe('DONE');
  218 |     expect(stopped.latestRun!.id).toBe(runId);
  219 |     expect(stopped.latestRun!.sessionId).toBe(sessionId);
  220 |     expect(stopped.latestRun!.review).toBeNull();
  221 |     await expect.poll(() => stripAnsi(output)).toContain('已取消');
  222 |     terminal.write('q');
  223 |     await expect.poll(() => history).toContain('\x1b[?1049l');
  224 |     writeFileSync(info.outputPath('pi-protocol-identity.json'), JSON.stringify({
  225 |       mode: 'local', evidenceKind: 'native-and-real-PTY-with-RPC-protocol-double', modelExecutionVerified: false,
  226 |       projectId, trackerId: id, runId, sessionId, workspace,
  227 |       initial, started, settled, stopped,
  228 |       verified: ['native-create', 'cancel-start-confirmation-does-not-launch', 'native-confirmed-target', 'streamed-output',
  229 |         'real-PTY-task-run-session-identity', 'GUI-message-to-same-run', 'PTY-message-to-same-run', 'authenticated-CLI-readback', 'native-confirmed-stop',
  230 |         'no-fake-DONE-or-verification', 'light-dark-native-screenshots', 'PTY-alternate-screen-restored'],
  231 |       notVerified: ['real-provider-or-model-call', 'real-tool-edit', 'real-diff-and-test-evidence', 'independent-acceptance-session'],
  232 |     }, null, 2));
  233 |   } finally {
  234 |     writeFileSync(info.outputPath('pi-protocol-pty.txt'), redact(history));
  235 |     terminal?.kill();
  236 |     // Stop only the run created here if an assertion interrupted the flow.
  237 |     if (runId && read) {
  238 |       try {
  239 |         const task = await read();
  240 |         if (['requested', 'accepted', 'executing', 'review_required', 'cancel_requested'].includes(task.latestRun?.status || '')) {
  241 |           await cli('run', 'cancel', '--id', runId, '--idempotency-key', `cleanup-${runId}`);
  242 |         }
  243 |       } catch (error) {
  244 |         writeFileSync(info.outputPath('pi-protocol-cleanup-error.txt'), redact(String(error)));
  245 |       }
  246 |     }
  247 |     // The isolated profile retains the theme displayed in the final screenshot.
  248 |     await browser.close();
  249 |   }
  250 | });
  251 | 
```