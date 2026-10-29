import { Archive, FileText, Mic, PenLine, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Logo, useDocumentTitle } from '../components/ui';
import { useSession } from '../lib/auth';

const FEATURES = [
  { icon: Mic, title: '实时语音转录', text: '面对面访谈、田野调查、组会，边说边出文字。每一句确认后的话都会立即保存。' },
  { icon: FileText, title: '参考资料同步查看', text: '访谈提纲、背景文献与笔记并排摆放。上传 PDF、Word、文本，或直接粘贴。' },
  { icon: PenLine, title: '人工笔记', text: '转录继续的同时随手记录原话、观察与追问，自动保存，绝不被 AI 改写。' },
  { icon: Sparkles, title: 'AI 智能纪要', text: '区分“受访者说了什么”“研究者记录了什么”“AI 推断了什么”，每条结论可回溯到转录原文。' },
  { icon: Archive, title: '历史记录与导出', text: '随时回看、校对转录，并导出为 Word、Markdown 或纯文本。' },
];

export default function Landing() {
  useDocumentTitle('');
  const { user } = useSession();
  const cta = user ? '/meetings' : '/register';
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-1 text-sm">
          <a href="#features" className="hidden rounded-lg px-3 py-1.5 text-ink-soft hover:bg-sunken sm:block">
            功能
          </a>
          {user ? (
            <Link to="/meetings" className="btn-primary btn-sm">
              我的会议
            </Link>
          ) : (
            <>
              <Link to="/login" className="rounded-lg px-3 py-1.5 text-ink-soft hover:bg-sunken">
                登录
              </Link>
              <Link to="/register" className="btn-primary btn-sm">
                开始使用
              </Link>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pb-12 pt-10 sm:px-6 sm:pt-16 lg:pt-20">
          <div className="max-w-3xl">
            <p className="mb-4 text-sm tracking-[0.18em] text-primary">为研究者而设计的访谈与会议工作台</p>
            <h1 className="font-serif text-4xl font-semibold leading-[1.15] sm:text-5xl lg:text-[3.4rem]">Every conversation, thoughtfully captured.</h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-soft">从实时转录到深度洞察，让每一次访谈与会议都成为可追溯的知识。</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={cta} className="btn-primary px-6 text-base">
                开始使用
              </Link>
              <Link to="/desktop" className="btn-secondary px-6 text-base">本机访谈（无需登录）</Link>
              <a href="#features" className="btn-secondary px-6 text-base">
                了解功能
              </a>
            </div>
          </div>

          <figure className="mt-14" aria-label="工作台界面示意">
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-line bg-sunken/60 px-4 py-2.5 text-sm">
                <div>
                  <span className="font-serif font-semibold">社区养老服务专题访谈</span>
                  <span className="ml-3 text-xs text-muted">2026年10月27日</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-ink-soft">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="rec-dot h-2 w-2 rounded-full bg-rec" /> 转录中 <span className="font-mono">00:17:32</span>
                  </span>
                  <span className="hidden text-primary sm:inline">✓ 已自动保存</span>
                </div>
              </div>
              <div className="grid divide-y divide-line md:grid-cols-[1fr_1.5fr_1fr] md:divide-x md:divide-y-0">
                <div className="p-4">
                  <h3 className="panel-title mb-2">参考资料</h3>
                  <p className="text-xs text-muted">研究主题：养老护理员职业发展</p>
                  <ul className="mt-3 space-y-2 text-sm">
                    <li className="flex gap-2"><span className="mt-1 h-4 w-4 shrink-0 rounded border border-primary bg-primary text-center text-[10px] leading-4 text-white">✓</span><span className="text-muted line-through">目前护理人员最主要的工作困难是什么？</span></li>
                    <li className="flex gap-2"><span className="mt-1 h-4 w-4 shrink-0 rounded border border-line-strong" /><span>您认为护理人员的专业培训是否充分？</span></li>
                    <li className="flex gap-2"><span className="mt-1 h-4 w-4 shrink-0 rounded border border-line-strong" /><span>人工智能技术可能如何改变护理工作？</span></li>
                  </ul>
                </div>
                <div className="p-4">
                  <h3 className="panel-title mb-2">实时转录</h3>
                  <div className="space-y-3 text-sm">
                    <p><span className="mr-2 font-mono text-xs text-muted">[00:02:15]</span><b className="font-medium">访谈员：</b>您觉得现在社区养老服务最需要改善的是什么？</p>
                    <p><span className="mr-2 font-mono text-xs text-muted">[00:02:24]</span><b className="font-medium">受访者：</b>我觉得最大的困难还是护理人员不足，而且专业培训也不够。</p>
                    <p className="text-muted"><span className="mr-2 font-mono text-xs">[00:02:41]</span><b className="font-medium">受访者：</b>培训主要靠老员工带，没有统一的考核……</p>
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="panel-title mb-2">人工笔记</h3>
                  <div className="space-y-2 text-sm">
                    <p className="rounded-lg bg-primary-soft/60 p-2.5"><span className="chip mb-1">研究者观察</span><br />受访者在讨论工资问题时表现出明显犹豫。</p>
                    <p className="rounded-lg bg-warn-soft p-2.5"><span className="chip mb-1">追问问题</span><br />培训项目是否有明确的考核制度？</p>
                  </div>
                </div>
              </div>
            </div>
            <figcaption className="mt-2 text-center text-xs text-muted">界面示意（示例文字）</figcaption>
          </figure>
        </section>

        <section id="features" className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="font-serif text-2xl font-semibold sm:text-3xl">从录音到纪要，一个安静的工作流</h2>
            <p className="mt-3 max-w-2xl text-ink-soft">创建会议 → 准备资料 → 开始转录 → 边听边记 → 生成纪要 → 校对与导出。</p>
            <div className="mt-10 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title}>
                  <f.icon className="h-5 w-5 text-primary" aria-hidden />
                  <h3 className="mt-3 font-serif text-lg font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-[0.95rem] leading-relaxed text-ink-soft">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
              <h2 className="mt-3 font-serif text-2xl font-semibold sm:text-3xl">对研究负责，也对数据诚实</h2>
            </div>
            <ul className="space-y-5 text-[0.95rem] leading-relaxed text-ink-soft">
              <li><b className="text-ink">转录、笔记、AI 分开呈现。</b>参考资料只是背景，不会被当作受访者说过的话；AI 引用的原话会与转录逐字核对。</li>
              <li><b className="text-ink">原始识别文本永远保留。</b>您校对时修改的是“修订版”，原文可随时对照与恢复。</li>
              <li><b className="text-ink">网络中断不会悄悄丢内容。</b>我们会自动重连、尽可能用本机缓存补录；确实无法找回的时间段会被明确标出。</li>
              <li><b className="text-ink">默认不在云端保存完整录音。</b>语音仅用于实时识别，保存的是文字记录。</li>
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>© Meetfolio · Every conversation, thoughtfully captured.</span>
          <span>录音前请告知参与者并取得必要的许可。</span>
        </div>
      </footer>
    </div>
  );
}
