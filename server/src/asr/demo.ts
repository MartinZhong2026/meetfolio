import { AsrError, bytesToMs, type AsrConnectOptions, type AsrConnection, type AsrHandlers, type AsrProvider } from './types.js';

export const DEMO_SCRIPT = [
  '您好，感谢您今天抽出时间接受访谈，我们先从您的工作经历开始聊起吧。',
  '好的，我在社区养老服务中心做护理员已经有八年了，主要照顾失能和半失能的老人。',
  '您觉得现在社区养老服务最需要改善的是什么？',
  '我觉得最大的困难还是护理人员不足，而且专业培训也不够，很多新来的同事上岗前只培训了三天。',
  '那么培训之后有没有明确的考核制度呢？',
  '考核有，但是比较形式化，主要是看有没有出勤，很少评估实际的护理技能。',
  '护理员的流动率高吗？大家为什么选择离开？',
  '流动率很高，主要是工资偏低，还有夜班多、职业认同感不强，家里人也不太理解这份工作。',
  '您怎么看待人工智能技术可能给护理工作带来的变化？',
  '如果是用来做监测和提醒，我觉得有帮助，可以减轻一部分负担，但是真正的照护还是需要人。',
  '对于认知障碍老人，您在日常照护中遇到过哪些挑战？',
  '最难的是沟通，他们有时候会重复同一个问题，需要特别有耐心，我们也希望有更系统的长期照护培训。',
  '好的，今天的访谈非常有价值，再次感谢您。',
];

/**
 * Synthetic provider for demo mode and development. It never opens a network connection, ignores the
 * audio content and drives a scripted Chinese interview purely from how much audio it has been sent.
 * Every segment it produces is stored with source='demo' and the UI labels the session clearly.
 */
export class DemoAsrProvider implements AsrProvider {
  readonly name = 'demo';
  readonly model = 'demo-script';
  readonly isDemo = true;
  private cursor = 0;
  /** Number of upcoming connect() calls that should fail (to demo reconnection). */
  failNextConnects = 0;

  constructor(private script: string[] = DEMO_SCRIPT) {}

  async connect(_o: AsrConnectOptions, handlers: AsrHandlers): Promise<AsrConnection> {
    if (this.failNextConnects > 0) {
      this.failNextConnects--;
      throw new AsrError('transient', 'demo_connect_failed', '演示：模拟连接失败');
    }
    let audioMs = 0;
    let closed = false;
    let lineStart = 500; // ms in this connection's timeline at which the current line begins
    let revealed = 0;
    const speakMsFor = (line: string) => Math.max(1800, line.length * 220);

    const advance = () => {
      while (!closed) {
        const line = this.script[this.cursor % this.script.length]!;
        const speak = speakMsFor(line);
        if (audioMs < lineStart) return;
        const spoken = Math.min(speak, audioMs - lineStart);
        const chars = Math.floor((spoken / speak) * line.length);
        if (spoken < speak) {
          if (chars > revealed) {
            revealed = chars;
            handlers.onResult({ kind: 'interim', key: String(lineStart), text: line.slice(0, chars), startMs: lineStart, endMs: null });
          }
          return;
        }
        handlers.onResult({ kind: 'final', key: String(lineStart), text: line, startMs: lineStart, endMs: lineStart + speak });
        this.cursor++;
        revealed = 0;
        lineStart = lineStart + speak + 900;
      }
    };

    const conn: AsrConnection & { kill(): void } = {
      sendAudio: (pcm) => {
        if (closed) return;
        audioMs += bytesToMs(pcm.length);
        advance();
      },
      finish: async () => {
        if (closed) return false;
        // Flush the line in progress as the provider would on end-of-task.
        const line = this.script[this.cursor % this.script.length]!;
        if (revealed > 0) {
          handlers.onResult({ kind: 'final', key: String(lineStart), text: line.slice(0, revealed), startMs: lineStart, endMs: Math.min(audioMs, lineStart + speakMsFor(line)) });
          this.cursor++;
        }
        closed = true;
        handlers.onClosed({ clean: true });
        return true;
      },
      close: () => {
        closed = true;
      },
      kill: () => {
        if (closed) return;
        closed = true;
        handlers.onClosed({ clean: false, error: new AsrError('transient', 'demo_dropped', '演示：模拟连接中断') });
      },
    };
    return conn;
  }
}
