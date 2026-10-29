import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Pencil, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, ApiError } from '../../lib/api';
import { fmtRelative } from '../../lib/format';
import type { Summary } from '../../lib/types';
import { useWorkspace } from '../../store/workspace';
import { Button, ConfirmDialog, Notice, Spinner, toast } from '../ui';

const ERR: Record<string, string> = {
  llm_not_configured: 'AI 服务尚未配置，请联系管理员（DASHSCOPE_API_KEY）。',
  llm_auth: 'AI 服务密钥无效或没有权限。',
  llm_model_not_found: '所选模型暂不可用，请改用“标准”模式。',
  llm_rate_limited: 'AI 服务繁忙，请稍后重试。',
  llm_timeout: '生成超时，请稍后重试。',
  llm_unavailable: 'AI 服务暂时不可用，请稍后重试。',
  llm_content_filtered: '内容未通过服务商的安全审核。',
  bad_model_output: '模型返回的内容格式不正确，请重新生成。',
  no_content: '还没有可供总结的转录或笔记。',
  server_restart: '生成过程被服务器重启打断，请重新生成。',
  summary_daily_limit: '今日生成次数已达上限。',
};

export function SummaryView({ meetingId, onJump }: { meetingId: string; onJump(target: { kind: 'segment' | 'note' | 'doc'; id: string; seq?: number }): void }) {
  const qc = useQueryClient();
  const meeting = useWorkspace((s) => s.meeting)!;
  const setSummary = useWorkspace((s) => s.setSummary);
  const config = useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: 5 * 60_000 });
  const list = useQuery({
    queryKey: ['summaries', meetingId],
    queryFn: async () => (await api.summaries(meetingId)).summaries,
    refetchInterval: (q) => (q.state.data?.some((s) => s.status === 'generating') ? 2500 : false),
  });
  const [versionId, setVersionId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'standard' | 'quality'>('standard');
  const [confirmRegen, setConfirmRegen] = useState(false);

  const summaries = list.data ?? [];
  const current: Summary | undefined = summaries.find((s) => s.id === versionId) ?? summaries.find((s) => s.status === 'ready') ?? summaries[0];
  const generating = summaries.some((s) => s.status === 'generating');

  useEffect(() => {
    if (summaries[0]) {
      useWorkspace.getState().patchMeeting({ summaryStatus: generating ? 'generating' : summaries.some((s) => s.status === 'ready') ? 'ready' : summaries[0].status === 'failed' ? 'failed' : 'none' });
      setSummary(summaries[0]);
    }
  }, [summaries, generating, setSummary]);

  const generate = useMutation({
    mutationFn: (m: 'standard' | 'quality' | 'interim') => api.generateSummary(meetingId, m),
    onSuccess: () => {
      setVersionId(null);
      void qc.invalidateQueries({ queryKey: ['summaries', meetingId] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? (ERR[e.code] ?? e.message) : '生成失败'),
  });
  const save = useMutation({
    mutationFn: (md: string | null) => api.saveSummary(meetingId, current!.id, md),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ['summaries', meetingId] });
      toast.success('已保存');
    },
    onError: () => toast.error('保存失败，请重试'),
  });

  const hasContent = useWorkspace((s) => s.segments.length > 0 || s.notes.some((n) => n.content.trim()));
  const body = current ? (current.editedMd ?? current.generatedMd) : '';

  if (list.isLoading) return <div className="flex items-center gap-2 py-16 text-muted"><Spinner /> 载入中…</div>;

  const generateBar = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" onClick={() => (current?.editedMd ? setConfirmRegen(true) : generate.mutate(mode))} loading={generate.isPending || generating} disabled={!hasContent || !config.data?.aiConfigured} data-testid="btn-generate">
        {current ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        {current ? '重新生成' : 'AI 生成纪要'}
      </Button>
      <select className="input !min-h-0 w-auto py-1.5 text-sm" value={mode} onChange={(e) => setMode(e.target.value as 'standard' | 'quality')} aria-label="生成质量">
        <option value="standard">标准（更快）</option>
        <option value="quality">高质量（更细致，较慢）</option>
      </select>
    </div>
  );

  if (!current) {
    return (
      <div className="card px-6 py-12 text-center">
        <Sparkles className="mx-auto h-6 w-6 text-primary" />
        <h2 className="mt-3 font-serif text-xl font-semibold">还没有 AI 纪要</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-soft">AI 会根据转录、您的笔记、访谈提纲和背景资料整理纪要，并区分“受访者说的”“您记录的”和“AI 推断的”。每条结论都能点回转录原文。</p>
        <div className="mt-6 flex justify-center">{generateBar}</div>
        {!hasContent && <p className="mt-3 text-sm text-muted">先有一些转录或笔记，才能生成纪要。</p>}
        {config.data && !config.data.aiConfigured && <p className="mt-3 text-sm text-warn">AI 服务尚未配置（需要 DASHSCOPE_API_KEY）。</p>}
        {meeting.transcriptStatus !== 'complete' && hasContent && (
          <p className="mt-4 text-sm">
            会议还在进行？ <button className="text-primary underline underline-offset-2 hover:no-underline" onClick={() => generate.mutate('interim')}>先生成一份中期纪要</button>
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {generateBar}
          {meeting.transcriptStatus !== 'complete' && !generating && (
            <Button size="sm" onClick={() => generate.mutate('interim')}>
              中期纪要
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted">
          {summaries.length > 1 && (
            <label className="inline-flex items-center gap-1">
              <History className="h-4 w-4" />
              <select className="rounded border-0 bg-transparent py-0 text-sm" value={current.id} onChange={(e) => setVersionId(e.target.value)} aria-label="历史版本">
                {summaries.map((s) => (
                  <option key={s.id} value={s.id}>
                    第 {s.version} 版 · {s.status === 'ready' ? (s.mode === 'interim' ? '中期' : s.mode === 'quality' ? '高质量' : '标准') : s.status === 'generating' ? '生成中' : '失败'}
                  </option>
                ))}
              </select>
            </label>
          )}
          {current.status === 'ready' && !editing && (
            <Button size="sm" onClick={() => (setDraft(body), setEditing(true))} data-testid="btn-edit-summary">
              <Pencil className="h-3.5 w-3.5" /> 编辑
            </Button>
          )}
        </div>
      </div>

      {current.status === 'generating' && (
        <div className="card flex items-center gap-3 px-5 py-10" role="status">
          <Spinner className="h-5 w-5" />
          <div>
            <p className="font-medium">正在生成纪要…</p>
            <p className="text-sm text-muted">较长的访谈会分段整理，可能需要几分钟。您可以离开此页，稍后回来查看。</p>
          </div>
        </div>
      )}
      {current.status === 'failed' && (
        <Notice kind="danger">
          生成失败：{ERR[current.errorCode ?? ''] ?? '请稍后重试。'}
        </Notice>
      )}

      {current.status === 'ready' && (
        <>
          <div className="mb-3 space-y-2">
            <Notice>
              AI 生成，仅供整理参考，请对照转录核实。{current.editedMd ? '当前显示的是您修改后的版本。' : ''}
              <span className="ml-2 text-muted">
                {current.model} · {fmtRelative(current.createdAt)}
              </span>
            </Notice>
            {current.stats?.fallbackFrom && <Notice kind="warn">所选模型 {current.stats.fallbackFrom} 暂不可用，已改用 {current.model} 生成。</Notice>}
            {!!current.stats?.droppedQuotes && (
              <Notice kind="warn">
                已过滤 {current.stats.droppedQuotes} 条无法在转录中逐字核实的引用；{current.stats.droppedUnsupported ? `另有 ${current.stats.droppedUnsupported} 条缺少转录依据的结论被省略。` : ''}
              </Notice>
            )}
            {!current.stats?.droppedQuotes && !!current.stats?.droppedUnsupported && <Notice kind="warn">有 {current.stats.droppedUnsupported} 条缺少转录依据的结论被省略。</Notice>}
            {!!current.stats?.truncatedDocs?.length && (
              <Notice kind="warn">
                参考资料较长，以下文档只有部分内容提供给了 AI：{current.stats.truncatedDocs.map((d) => `${d.title}（${d.includedChars}/${d.totalChars} 字）`).join('、')}。
              </Notice>
            )}
            {meeting.transcriptStatus !== 'complete' && current.mode === 'interim' && <Notice>这是会议进行中生成的中期纪要，会议结束后建议重新生成。</Notice>}
          </div>

          {editing ? (
            <div className="card p-4">
              <textarea className="input min-h-[420px] font-mono text-sm leading-relaxed" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="编辑纪要（Markdown）" />
              <p className="mt-2 text-xs text-muted">使用 Markdown 格式。形如 [00:02:15](#seg-12) 的链接可点回转录原文。AI 原文始终保留，随时可恢复。</p>
              <div className="mt-3 flex flex-wrap justify-between gap-2">
                <div className="flex gap-2">
                  <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(draft)}>
                    保存
                  </Button>
                  <Button onClick={() => setEditing(false)}>取消</Button>
                </div>
                {current.editedMd !== null && (
                  <Button variant="ghost" onClick={() => save.mutate(null)}>
                    恢复为 AI 原文
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <article className="card prose-mf px-5 py-5 sm:px-8 sm:py-7" data-testid="summary-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => {
                    if (href?.startsWith('#seg-')) {
                      const seq = Number(href.slice(5));
                      return (
                        <a href={href} className="seg-link" title="查看对应的转录原文" onClick={(e) => (e.preventDefault(), onJump({ kind: 'segment', id: '', seq }))}>
                          {children}
                        </a>
                      );
                    }
                    if (href?.startsWith('#note-')) {
                      return (
                        <a href={href} className="seg-link" onClick={(e) => (e.preventDefault(), onJump({ kind: 'note', id: href.slice(6) }))}>
                          {children}
                        </a>
                      );
                    }
                    if (href?.startsWith('#doc-')) {
                      return (
                        <a href={href} className="seg-link" onClick={(e) => (e.preventDefault(), onJump({ kind: 'doc', id: href.slice(5) }))}>
                          {children}
                        </a>
                      );
                    }
                    return (
                      <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline">
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {body}
              </ReactMarkdown>
            </article>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirmRegen}
        onOpenChange={setConfirmRegen}
        title="重新生成纪要？"
        description="会生成一个新版本。您修改过的当前版本不会丢失，可在“历史版本”中找回。"
        confirmLabel="重新生成"
        onConfirm={() => {
          setConfirmRegen(false);
          generate.mutate(mode);
        }}
      />
    </div>
  );
}
