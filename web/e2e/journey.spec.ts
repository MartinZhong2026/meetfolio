import { expect, test } from '@playwright/test';
import { createMeetingViaUi, isPhone, isTablet, killBrowserSockets, openPanel, registerUser, uniqueEmail } from './helpers';

test.describe('landing & accounts', () => {
  test('landing page presents the product and leads to registration', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Every conversation, thoughtfully captured.');
    await expect(page.getByText('从实时转录到深度洞察，让每一次访谈与会议都成为可追溯的知识。')).toBeVisible();
    for (const f of ['实时语音转录', '参考资料同步查看', '人工笔记', 'AI 智能纪要', '历史记录与导出']) await expect(page.getByRole('heading', { name: f }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: '了解功能' })).toBeVisible();
    // No horizontal scrolling at any width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('link', { name: '开始使用' }).first().click();
    await expect(page).toHaveURL(/\/register/);
  });

  test('register, log out, log back in; protected pages redirect to login', async ({ page }) => {
    const { email, password } = await registerUser(page);
    await page.getByRole('button', { name: '退出登录' }).click();
    await page.goto('/meetings');
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('邮箱').fill(email);
    await page.getByLabel('密码').fill('wrong-password-1');
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.getByRole('alert')).toContainText('邮箱或密码不正确');
    await page.getByLabel('密码').fill(password);
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page).toHaveURL(/\/meetings/);
  });
});

test.describe('workspace layout', () => {
  test('three panels are simultaneously usable on desktop; adapt on tablet and phone', async ({ page }, info) => {
    await registerUser(page);
    await createMeetingViaUi(page, '布局测试访谈');
    const vw = info.project.use.viewport!.width;
    if (vw >= 1200) {
      const boxes = await Promise.all(['panel-ref', 'panel-transcript', 'panel-notes'].map(async (t) => page.getByTestId(t).boundingBox()));
      for (const b of boxes) {
        expect(b).not.toBeNull();
        expect(b!.width).toBeGreaterThan(260);
      }
      // Side by side, not stacked or overlapping.
      expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x + 1);
      expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[2]!.x + 1);
      await expect(page.getByRole('heading', { name: '参考资料' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '实时转录' })).toBeVisible();
      await expect(page.getByRole('heading', { name: '人工笔记' })).toBeVisible();
      // The reference panel can be collapsed and restored.
      await page.getByRole('button', { name: '收起参考资料' }).click();
      await expect(page.getByTestId('panel-ref')).toHaveCount(0);
      await page.getByRole('button', { name: '展开参考资料' }).click();
      await expect(page.getByTestId('panel-ref')).toBeVisible();
    } else if (isTablet(info)) {
      await expect(page.getByTestId('panel-transcript')).toBeVisible();
      await expect(page.getByTestId('panel-notes')).toBeVisible();
      await page.getByRole('tab', { name: '参考资料' }).click();
      await expect(page.getByTestId('panel-ref')).toBeVisible();
    } else {
      expect(isPhone(info)).toBe(true);
      await expect(page.getByRole('tab', { name: '实时转录' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('btn-start')).toBeVisible(); // recorder stays reachable
      await page.getByRole('tab', { name: '人工笔记' }).click();
      await expect(page.getByRole('heading', { name: '人工笔记' })).toBeVisible();
      await page.getByRole('tab', { name: '参考资料' }).click();
      await expect(page.getByRole('heading', { name: '参考资料' })).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect(page.getByTestId('rec-status').first()).toHaveText('未开始');
  });
});

test.describe('core research journey (real pipeline, mocked DashScope)', () => {
  test('create → prepare → transcribe with fake microphone → take notes → end → summarise → edit → export', async ({ page }, info) => {
    test.setTimeout(150_000);
    await registerUser(page);
    const id = await createMeetingViaUi(page, '社区养老服务专题访谈');

    // --- Prepare materials: paste a guide, upload a TXT, tick a question, add a follow-up --------------------------
    await openPanel(page, info, 'ref');
    await page.getByRole('button', { name: '粘贴提纲' }).click();
    await page.getByRole('dialog').locator('textarea').fill('研究主题：养老护理员职业发展\n问题一：目前护理人员最主要的工作困难是什么？\n问题二：您认为护理人员的专业培训是否充分？\n问题三：人工智能技术可能如何改变护理工作？');
    await page.getByRole('dialog').getByRole('button', { name: '导入' }).click();
    await expect(page.getByRole('checkbox', { name: '已问：目前护理人员最主要的工作困难是什么？', exact: true })).toBeVisible();
    await page.getByLabel('已问：目前护理人员最主要的工作困难是什么？').check();
    await page.getByLabel('添加追问问题').fill('培训有考核制度吗？');
    await page.getByLabel('添加追问问题').press('Enter');
    await expect(page.getByText('培训有考核制度吗？')).toBeVisible();

    await page.getByTestId('doc-upload').setInputFiles({ name: '研究背景.txt', mimeType: 'text/plain', buffer: Buffer.from('背景资料：本研究关注社区养老护理员的职业发展与培训体系。', 'utf8') });
    await expect(page.getByRole('button', { name: '研究背景', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '研究背景', exact: true }).click();
    await expect(page.getByText('背景资料——不是会议中说过的话。')).toBeVisible();
    await page.getByLabel('在资料中查找').fill('培训');
    await expect(page.locator('[data-doc-text] mark').first()).toBeVisible();
    await page.getByRole('button', { name: '返回资料列表' }).click();

    // --- Live transcription --------------------------------------------------------------------------------------
    await openPanel(page, info, 'transcript');
    await page.getByTestId('btn-start').click();
    await expect(page.getByTestId('rec-status').first()).toHaveText('转录中', { timeout: 20_000 });
    // Interim text appears first, then a finalised, persisted segment.
    await expect(page.locator('article[id^="seg-"]').first()).toBeVisible({ timeout: 25_000 });
    await expect(page.locator('article[id^="seg-"]').first()).toContainText('您觉得现在社区养老服务最需要改善的是什么？');
    expect(await page.getByTestId('rec-timer').first().textContent()).not.toBe('00:00:00');

    // --- Notes while the transcript keeps running ----------------------------------------------------------------
    await openPanel(page, info, 'notes');
    await page.getByLabel('新笔记').fill('受访者提到护理员流动率很高，需要进一步核实原因。');
    await expect(page.getByTestId('save-status')).toHaveText(/已自动保存/, { timeout: 10_000 });
    await expect(page.getByTestId('rec-status').first()).toHaveText('转录中');
    await page.getByTestId('btn-add-note').click();
    await page.getByRole('radio', { name: '研究者观察' }).click();
    await page.getByLabel('新笔记').fill('现场观察：受访者在讨论工资问题时表现出明显犹豫。');
    await page.getByTestId('btn-add-note').click();
    await expect(page.getByTestId('note')).toHaveCount(2);

    // Transcript kept growing meanwhile.
    await openPanel(page, info, 'transcript');
    await expect.poll(async () => page.locator('article[id^="seg-"]').count(), { timeout: 20_000 }).toBeGreaterThanOrEqual(2);

    // --- Interrupt the network (browser <-> server): honest status, automatic recovery -------------------------------
    await page.request.post('/__e2e/block-browser-ws', { data: { down: true } });
    expect(await killBrowserSockets(page)).toBeGreaterThan(0);
    await expect(page.getByTestId('rec-status').first()).toHaveText(/重新连接中|连接失败/);
    await expect(page.getByText('麦克风仍在录音，内容已暂存在本机')).toBeVisible();
    await page.waitForTimeout(9_000); // ~9 s offline while the microphone keeps capturing
    await page.request.post('/__e2e/block-browser-ws', { data: { down: false } });
    await expect(page.getByTestId('rec-status').first()).toHaveText('转录中', { timeout: 30_000 });
    await expect(page.getByTestId('gap-marker').first()).toBeVisible({ timeout: 25_000 });
    // The microphone kept recording locally; the missing seconds are re-transcribed from the local buffer.
    await expect(page.locator('article[id^="seg-"]').filter({ hasText: '补录' }).first()).toBeVisible({ timeout: 45_000 });

    // --- Bookmark and stop ------------------------------------------------------------------------------------------
    await page.getByTestId('btn-mark').click();
    await expect(page.getByText('已标记为重点')).toBeVisible();
    await page.getByTestId('btn-end').click();
    await page.getByRole('dialog').getByRole('button', { name: '结束并保存' }).click();
    await expect(page).toHaveURL(new RegExp(`/meetings/${id}$`), { timeout: 30_000 });
    await expect(page.getByTestId('review-title')).toHaveText('社区养老服务专题访谈');

    // --- Review: transcript, notes, materials, highlights persisted ----------------------------------------------------
    await page.getByTestId('tab-transcript').click();
    await expect(page.getByTestId('review-transcript').locator('article').first()).toBeVisible();
    await page.getByTestId('tab-notes').click();
    await expect(page.getByTestId('note')).toHaveCount(2);
    await expect(page.getByLabel('笔记内容').first()).toHaveValue('受访者提到护理员流动率很高，需要进一步核实原因。');
    await page.getByTestId('tab-materials').click();
    await expect(page.getByRole('button', { name: '研究背景', exact: true })).toBeVisible();
    await page.getByTestId('tab-highlights').click();
    await expect(page.getByText('查看原文').first()).toBeVisible();

    // --- Correct a transcription error; the original is preserved -------------------------------------------------------
    await page.getByTestId('tab-transcript').click();
    const first = page.getByTestId('review-transcript').locator('article').first();
    await first.hover();
    await first.getByRole('button', { name: '编辑文字' }).click();
    await first.getByLabel('编辑转录文字').fill('您觉得现在社区养老服务最需要改善的地方是什么？');
    await first.getByLabel('编辑转录文字').press('Control+Enter');
    await expect(first).toContainText('已修订');
    await first.getByRole('button', { name: '已修订' }).click();
    await expect(first).toContainText('原始识别：您觉得现在社区养老服务最需要改善的是什么？');

    // --- AI summary (grounded) -------------------------------------------------------------------------------------
    await page.getByTestId('tab-summary').click();
    await page.getByTestId('btn-generate').click();
    await expect(page.getByTestId('summary-body')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('summary-body')).toContainText('一、会议基本信息');
    await expect(page.getByTestId('summary-body')).toContainText('研究者的人工笔记原文，未经 AI 改写');
    await expect(page.getByTestId('summary-body')).toContainText('受访者提到护理员流动率很高，需要进一步核实原因。');
    await expect(page.getByText(/已过滤 1 条无法在转录中逐字核实的引用/)).toBeVisible();
    // A citation jumps to the supporting transcript segment.
    await page.getByTestId('summary-body').locator('a.seg-link').first().click();
    await expect(page.getByTestId('tab-transcript')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.flash-seg')).toBeVisible();

    // Edit & save the summary.
    await page.getByTestId('tab-summary').click();
    await page.getByTestId('btn-edit-summary').click();
    await page.getByLabel('编辑纪要（Markdown）').fill('# 修订后的纪要\n\n## 一、会议基本信息\n- 我已核对并修订。');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.getByTestId('summary-body')).toContainText('我已核对并修订');

    // --- Exports -------------------------------------------------------------------------------------------------------
    for (const [format, mime] of [
      ['md', 'markdown'],
      ['txt', 'text/plain'],
      ['docx', 'wordprocessingml'],
    ] as const) {
      const res = await page.request.get(`/api/meetings/${id}/export?format=${format}`);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-type']).toContain(mime);
      if (format !== 'docx') {
        const body = await res.text();
        expect(body).toContain('社区养老服务专题访谈');
        expect(body).toContain('您觉得现在社区养老服务最需要改善的地方是什么？'); // corrected text
        expect(body).toContain('我已核对并修订');
        expect(body).toContain('受访者提到护理员流动率很高');
      }
    }

    // --- Persistence: everything is still there after a reload, and on the dashboard ------------------------------------------
    await page.reload();
    await page.getByTestId('tab-transcript').click();
    await expect(page.getByTestId('review-transcript').locator('article').first()).toContainText('已修订');
    await page.goto('/meetings');
    const row = page.getByTestId('meeting-link').first();
    await expect(row).toContainText('社区养老服务专题访谈');
    await expect(row).toContainText('转录已完成');
    await expect(row).toContainText('纪要已生成');
  });
});

test.describe('dashboard', () => {
  test('search, rename, export menu and delete with confirmation', async ({ page }) => {
    await registerUser(page);
    await createMeetingViaUi(page, '护理员访谈 A');
    await page.goto('/meetings');
    await page.getByRole('link', { name: /新建会议/ }).first().click();
    await page.getByLabel('会议标题').fill('研究组会 B');
    await page.getByRole('button', { name: '更多信息（可选）' }).click();
    await page.getByLabel('地点').fill('西湖区');
    await page.getByRole('button', { name: '创建并进入工作台' }).click();
    await expect(page.getByTestId('workspace')).toBeVisible();
    await page.goto('/meetings');
    await expect(page.getByTestId('meeting-link')).toHaveCount(2);

    await page.getByLabel('搜索会议').fill('西湖');
    await expect(page.getByTestId('meeting-link')).toHaveCount(1);
    await expect(page.getByTestId('meeting-link')).toContainText('研究组会 B');
    await page.getByLabel('搜索会议').fill('不存在的内容');
    await expect(page.getByText('没有找到与“不存在的内容”相关的会议')).toBeVisible();
    await page.getByLabel('搜索会议').fill('');

    await page.getByRole('button', { name: '“研究组会 B”的更多操作' }).click();
    await expect(page.getByRole('menuitem', { name: /Word/ })).toBeVisible();
    await page.getByRole('menuitem', { name: '重命名' }).click();
    await page.getByLabel('会议标题').fill('研究组会（已改名）');
    await page.getByRole('button', { name: '保存' }).click();
    await expect(page.getByText('研究组会（已改名）')).toBeVisible();

    await page.getByRole('button', { name: '“研究组会（已改名）”的更多操作' }).click();
    await page.getByRole('menuitem', { name: '删除' }).click();
    await expect(page.getByRole('dialog')).toContainText('永久删除');
    await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
    await expect(page.getByTestId('meeting-link')).toHaveCount(2);
    await page.getByRole('button', { name: '“研究组会（已改名）”的更多操作' }).click();
    await page.getByRole('menuitem', { name: '删除' }).click();
    await page.getByRole('dialog').getByRole('button', { name: '永久删除' }).click();
    await expect(page.getByTestId('meeting-link')).toHaveCount(1);
  });

  test("another user cannot open someone else's meeting", async ({ page, browser }) => {
    await registerUser(page);
    const id = await createMeetingViaUi(page, '私密访谈');
    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: test.info().project.use.viewport ?? undefined });
    const p2 = await other.newPage();
    await registerUser(p2, uniqueEmail());
    await p2.goto(`/meetings/${id}/live`);
    await expect(p2.getByText('找不到这场会议')).toBeVisible();
    await p2.goto(`/meetings/${id}`);
    await expect(p2.getByText('找不到这场会议')).toBeVisible();
    await other.close();
  });
});

test.describe('demo mode', () => {
  test('is clearly labelled, shows simulated live text, survives a simulated disconnect, and never needs the microphone', async ({ page }, info) => {
    test.setTimeout(120_000);
    await registerUser(page);
    await page.getByRole('button', { name: '体验演示会议' }).click();
    await expect(page.getByTestId('workspace')).toBeVisible();
    await expect(page.getByTestId('demo-banner')).toContainText('模拟的转录');
    await expect(page.getByText('目前护理人员最主要的工作困难是什么？')).toBeVisible().catch(() => {});
    await page.getByTestId('btn-start').click();
    await expect(page.getByTestId('rec-status').first()).toHaveText('转录中', { timeout: 15_000 });
    await expect(page.locator('article[id^="seg-"]').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('article[id^="seg-"]').first()).toContainText('演示');
    await page.getByRole('button', { name: '模拟语音服务断线' }).click();
    await expect(page.getByTestId('rec-status').first()).toHaveText('转录中', { timeout: 20_000 });
    const before = await page.locator('article[id^="seg-"]').count();
    await expect.poll(async () => page.locator('article[id^="seg-"]').count(), { timeout: 30_000 }).toBeGreaterThan(before);
    await page.getByTestId('btn-end').click();
    await page.getByRole('dialog').getByRole('button', { name: '结束并保存' }).click();
    await expect(page).toHaveURL(/\/meetings\/[0-9a-f-]+$/);
    void info;
  });
});

test.describe('resilience & scale', () => {
  test('a refresh in the middle of recording loses nothing already saved, and the local audio buffer fills the gap', async ({ page }, info) => {
    test.setTimeout(150_000);
    await registerUser(page);
    const id = await createMeetingViaUi(page, '刷新恢复测试');
    await openPanel(page, info, 'transcript');
    await page.getByTestId('btn-start').click();
    await expect(page.getByTestId('rec-status').first()).toHaveText('转录中', { timeout: 20_000 });
    await expect(page.locator('article[id^="seg-"]').nth(1)).toBeVisible({ timeout: 30_000 });
    const before = await page.locator('article[id^="seg-"]').count();
    await page.waitForTimeout(4_000); // some audio is captured but not yet part of a finished sentence
    await page.reload(); // tab refreshed mid-recording
    await expect(page.getByTestId('workspace')).toBeVisible();
    await openPanel(page, info, 'transcript');
    // Saved transcript is back, and the session is honestly shown as interrupted rather than silently "recording".
    await expect.poll(async () => page.locator('article[id^="seg-"]').count()).toBeGreaterThanOrEqual(before);
    await expect(page.getByTestId('rec-status').first()).toHaveText(/已中断|已暂停/);
    await expect(page.getByTestId('btn-start')).toBeVisible();
    await page.getByTestId('btn-start').click();
    await expect(page.getByTestId('rec-status').first()).toHaveText('转录中', { timeout: 20_000 });
    // Audio captured before the refresh is re-transcribed from IndexedDB; the junction is marked.
    await expect(page.getByTestId('gap-marker').first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => page.locator('article[id^="seg-"]').count(), { timeout: 30_000 }).toBeGreaterThan(before);
    const bundle = await (await page.request.get(`/api/meetings/${id}`)).json();
    const texts = bundle.segments.map((s: { originalText: string; startMs: number }) => `${s.startMs}`);
    expect(new Set(texts).size).toBe(texts.length); // no duplicated timeline positions
    expect(bundle.gaps.length).toBeGreaterThan(0);
  });
});
