import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, ClipboardPaste, FileText, ListPlus, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { countMatches, highlight } from '../../lib/highlight';
import { uuid } from '../../lib/format';
import type { Question, RefDoc } from '../../lib/types';
import { tracked, useWorkspace } from '../../store/workspace';
import { Button, Modal, Notice, Spinner, toast } from '../ui';

function Guide({ meetingId }: { meetingId: string }) {
  const questions = useWorkspace((s) => s.questions);
  const setQuestions = useWorkspace((s) => s.setQuestions);
  const topic = useWorkspace((s) => s.meeting?.guideTopic ?? '');
  const patchMeeting = useWorkspace((s) => s.patchMeeting);
  const [followup, setFollowup] = useState('');
  const [importing, setImporting] = useState(false);
  const [text, setText] = useState('');
  const [topicDraft, setTopicDraft] = useState<string | null>(null);

  const done = questions.filter((q) => q.done).length;

  const upsert = async (q: Question) => {
    setQuestions(useWorkspace.getState().questions.some((x) => x.id === q.id) ? useWorkspace.getState().questions.map((x) => (x.id === q.id ? q : x)) : [...useWorkspace.getState().questions, q]);
    try {
      await tracked(() => api.putQuestion(meetingId, q.id, { text: q.text, done: q.done, isFollowup: q.isFollowup }));
    } catch {
      toast.error('保存失败');
    }
  };
  const toggle = (q: Question) => void upsert({ ...q, done: !q.done });
  const remove = async (q: Question) => {
    const prev = questions;
    setQuestions(prev.filter((x) => x.id !== q.id));
    try {
      await tracked(() => api.deleteQuestion(meetingId, q.id));
    } catch {
      setQuestions(prev);
      toast.error('删除失败');
    }
  };
  const addFollowup = () => {
    const t = followup.trim();
    if (!t) return;
    const pos = Math.max(-1, ...questions.map((q) => q.position)) + 1;
    void upsert({ id: uuid(), text: t, done: false, isFollowup: true, position: pos });
    setFollowup('');
  };
  const doImport = useMutation({
    mutationFn: () => api.importGuide(meetingId, text, false),
    onSuccess: (r) => {
      setQuestions(r.questions);
      if (r.topic) patchMeeting({ guideTopic: r.topic });
      setImporting(false);
      setText('');
      toast.success(`已导入 ${r.questions.length} 个问题`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '导入失败'),
  });
  const saveTopic = async () => {
    const v = (topicDraft ?? topic).trim();
    setTopicDraft(null);
    if (v === topic) return;
    patchMeeting({ guideTopic: v });
    try {
      await tracked(() => api.updateMeeting(meetingId, { guideTopic: v }));
    } catch {
      toast.error('保存失败');
    }
  };

  return (
    <section aria-label="访谈提纲">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-soft">
          访谈提纲 {questions.length > 0 && <span className="ml-1 font-normal text-muted">{done}/{questions.length}</span>}
        </h3>
        <button className="btn-ghost btn-sm" onClick={() => setImporting(true)}>
          <ListPlus className="h-3.5 w-3.5" /> 粘贴提纲
        </button>
      </div>
      <input
        className="mt-1 w-full rounded border border-transparent bg-transparent px-1 py-1 text-sm text-ink-soft placeholder:text-muted/70 hover:border-line focus:border-primary focus:bg-surface focus:outline-none"
        placeholder="研究主题（点击填写）"
        value={topicDraft ?? topic}
        onChange={(e) => setTopicDraft(e.target.value)}
        onBlur={() => void saveTopic()}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label="研究主题"
        maxLength={500}
      />
      {questions.length === 0 ? (
        <p className="mt-2 text-sm text-muted">还没有问题。可以粘贴整份提纲（每行一个问题），或在下方逐条添加。</p>
      ) : (
        <ol className="mt-2 space-y-1">
          {questions.map((q, i) => (
            <li key={q.id} className="group flex items-start gap-2 rounded-lg px-1.5 py-1.5 hover:bg-sunken/70">
              <input type="checkbox" checked={q.done} onChange={() => toggle(q)} className="mt-1.5 h-4 w-4 shrink-0 accent-[#355F52]" aria-label={`已问：${q.text}`} />
              <span className={`min-w-0 flex-1 text-[0.95rem] leading-relaxed ${q.done ? 'text-muted line-through' : ''}`}>
                <span className="mr-1 text-muted">{i + 1}.</span>
                {q.text}
                {q.isFollowup && <span className="chip ml-1.5 py-0 text-[11px]">追问</span>}
              </span>
              <button className="btn-icon !h-7 !w-7 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" aria-label="删除问题" onClick={() => void remove(q)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-2 flex gap-2">
        <input
          className="input !min-h-0 py-1.5 text-sm"
          placeholder="添加追问问题，按回车"
          value={followup}
          onChange={(e) => setFollowup(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && (e.preventDefault(), addFollowup())}
          aria-label="添加追问问题"
          maxLength={1000}
        />
        <Button size="sm" onClick={addFollowup} disabled={!followup.trim()} aria-label="添加">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Modal open={importing} onOpenChange={setImporting} title="粘贴访谈提纲" description="每行一个问题。可以带“问题一：”“1.”等编号；以“研究主题：”开头的一行会作为主题。" wide>
        <textarea className="input min-h-[200px]" value={text} onChange={(e) => setText(e.target.value)} placeholder={'研究主题：养老护理员职业发展\n问题一：目前护理人员最主要的工作困难是什么？\n问题二：您认为护理人员的专业培训是否充分？'} autoFocus />
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setImporting(false)}>取消</Button>
          <Button variant="primary" loading={doImport.isPending} disabled={!text.trim()} onClick={() => doImport.mutate()}>
            导入
          </Button>
        </div>
      </Modal>
    </section>
  );
}

function DocViewer({ meetingId, doc, onBack }: { meetingId: string; doc: RefDoc; onBack(): void }) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => {
    let alive = true;
    api
      .docText(meetingId, doc.id)
      .then((r) => alive && setText(r.text))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [meetingId, doc.id]);
  const total = useMemo(() => (text ? countMatches(text, term) : 0), [text, term]);
  useEffect(() => setActive(0), [term]);
  useEffect(() => {
    if (term) document.querySelector(`[data-doc-text] [data-match="${active}"]`)?.scrollIntoView({ block: 'center' });
  }, [active, term, total]);
  const counter = { n: 0 };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2">
        <button className="btn-icon" onClick={onBack} aria-label="返回资料列表">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{doc.title}</h3>
      </div>
      <p className="mt-1 rounded bg-sunken px-2 py-1 text-xs text-muted">背景资料——不是会议中说过的话。</p>
      <div className="relative mt-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <input className="input !min-h-0 py-1.5 pl-8 pr-24 text-sm" placeholder="在资料中查找" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="在资料中查找" />
        {term && (
          <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 text-xs text-muted">
            {total ? `${active + 1}/${total}` : '无结果'}
            <button className="px-1" aria-label="上一个" disabled={!total} onClick={() => setActive((a) => (a - 1 + total) % total)}>
              ↑
            </button>
            <button className="px-1" aria-label="下一个" disabled={!total} onClick={() => setActive((a) => (a + 1) % total)}>
              ↓
            </button>
          </span>
        )}
      </div>
      <div className="scroll-quiet mt-2 min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-surface p-3" data-doc-text>
        {err ? (
          <p className="text-sm text-danger">无法载入文本。</p>
        ) : text === null ? (
          <Spinner />
        ) : text ? (
          <p className="whitespace-pre-wrap break-words text-[0.95rem] leading-[1.8]">{highlight(text, term, active, counter)}</p>
        ) : (
          <p className="text-sm text-muted">{doc.extractionStatus === 'failed' ? '文件已保存，但无法读取其中的文字。' : '未能从该文件提取文字（可能是扫描件或图片）。'}</p>
        )}
        {doc.extractionStatus === 'truncated' && <p className="mt-2 text-xs text-warn">文本过长，仅显示前 100 万字。</p>}
      </div>
    </div>
  );
}

function Materials({ meetingId, onOpen }: { meetingId: string; onOpen(d: RefDoc): void }) {
  const docs = useWorkspace((s) => s.documents);
  const setDocs = useWorkspace((s) => s.setDocuments);
  const [pasting, setPasting] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    for (const f of Array.from(files)) {
      try {
        const { document } = await api.uploadDoc(meetingId, f);
        setDocs([...useWorkspace.getState().documents, document]);
        if (document.extractionStatus === 'empty') toast.info(`“${f.name}”已保存，但没有提取到文字（可能是扫描件）。`);
        else if (document.extractionStatus === 'failed') toast.error(`“${f.name}”已保存，但无法读取其中的文字。`);
        else toast.success(`已添加“${f.name}”`);
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : `上传“${f.name}”失败`);
      }
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = '';
  };
  const paste = useMutation({
    mutationFn: () => api.pasteDoc(meetingId, title.trim() || '研究背景', text),
    onSuccess: ({ document }) => {
      setDocs([...useWorkspace.getState().documents, document]);
      setPasting(false);
      setTitle('');
      setText('');
      toast.success('已添加');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '保存失败'),
  });
  const remove = async (d: RefDoc) => {
    if (!window.confirm(`删除资料“${d.title}”？`)) return;
    try {
      await api.deleteDoc(meetingId, d.id);
      setDocs(useWorkspace.getState().documents.filter((x) => x.id !== d.id));
    } catch {
      toast.error('删除失败');
    }
  };

  return (
    <section aria-label="资料">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink-soft">背景资料</h3>
        <div className="flex gap-1">
          <button className="btn-ghost btn-sm" onClick={() => setPasting(true)}>
            <ClipboardPaste className="h-3.5 w-3.5" /> 粘贴
          </button>
          <button className="btn-ghost btn-sm" onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? <Spinner /> : <Upload className="h-3.5 w-3.5" />} 上传
          </button>
          <input ref={fileInput} type="file" hidden multiple accept=".pdf,.docx,.txt,.md,.markdown" onChange={(e) => void upload(e.target.files)} data-testid="doc-upload" />
        </div>
      </div>
      {docs.length === 0 ? (
        <p className="mt-2 text-sm text-muted">支持 PDF、Word（.docx）、TXT、Markdown，或直接粘贴文字。资料只作背景参考，不会被当作发言。</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {docs.map((d) => (
            <li key={d.id} className="group flex items-center gap-1 rounded-lg hover:bg-sunken/70">
              <button className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-2 text-left" onClick={() => onOpen(d)}>
                <FileText className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-[0.95rem]">{d.title}</span>
                {d.extractionStatus !== 'ok' && <span className="chip py-0 text-[11px] text-warn">{d.extractionStatus === 'empty' ? '无文字' : d.extractionStatus === 'failed' ? '无法读取' : '已截断'}</span>}
              </button>
              <button className="btn-icon !h-7 !w-7 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100" aria-label={`删除资料 ${d.title}`} onClick={() => void remove(d)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={pasting} onOpenChange={setPasting} title="粘贴背景资料" description="例如研究背景、文献摘录、案例介绍。" wide>
        <div className="space-y-3">
          <input className="input" placeholder="标题（如：研究背景）" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
          <textarea className="input min-h-[220px]" value={text} onChange={(e) => setText(e.target.value)} placeholder="粘贴文字…" autoFocus />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setPasting(false)}>取消</Button>
          <Button variant="primary" loading={paste.isPending} disabled={!text.trim()} onClick={() => paste.mutate()}>
            保存
          </Button>
        </div>
      </Modal>
    </section>
  );
}

export function ReferencePanel({ meetingId, onCollapse }: { meetingId: string; onCollapse?: () => void }) {
  const [open, setOpen] = useState<RefDoc | null>(null);
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="参考资料">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="panel-title">参考资料</h2>
        {onCollapse && (
          <button className="btn-icon !h-8 !w-8" onClick={onCollapse} aria-label="收起参考资料">
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {open ? (
          <DocViewer meetingId={meetingId} doc={open} onBack={() => setOpen(null)} />
        ) : (
          <div className="space-y-6">
            <Notice>参考资料是背景信息，不会被当作受访者说过的话。</Notice>
            <Guide meetingId={meetingId} />
            <Materials meetingId={meetingId} onOpen={setOpen} />
          </div>
        )}
      </div>
    </section>
  );
}
