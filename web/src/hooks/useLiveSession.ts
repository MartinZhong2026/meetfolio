import { useCallback, useEffect, useRef } from 'react';
import { MeetingAudioBuffer } from '../audio/chunkStore';
import { MicCapture, SyntheticCapture } from '../audio/capture';
import { recoverGapFromLocalAudio } from '../audio/gapRecovery';
import { Transcriber, type TranscriberEvents } from '../audio/transcriber';
import { api } from '../lib/api';
import { ERROR_HINTS } from '../lib/zh';
import { toast } from '../components/ui';
import { flushAllNotes, useWorkspace } from '../store/workspace';

/** Owns the live capture session for the open meeting and mirrors its events into the workspace store. */
export function useLiveSession(meetingId: string) {
  const ref = useRef<Transcriber | null>(null);

  const events = useCallback((): TranscriberEvents => {
    const st = useWorkspace;
    return {
      state: (state, info) => {
        st.getState().patchRec({ state, attempt: info?.attempt ?? 0, connectionFailed: info?.connectionFailed ?? false });
        if (state === 'recording' && st.getState().meeting?.transcriptStatus !== 'in_progress') st.getState().patchMeeting({ transcriptStatus: 'in_progress', endedAt: null });
      },
      position: (positionMs) => st.getState().patchRec({ positionMs }),
      level: (level) => st.getState().patchRec({ level }),
      interim: (i) => st.getState().setInterim(i),
      final: (seg, interimKey) => {
        const s = st.getState();
        s.upsertSegment(seg);
        if (s.interim && (!interimKey || s.interim.key === interimKey)) s.setInterim(null);
        if (seg.endMs > s.rec.positionMs) st.getState().patchRec({ positionMs: Math.max(s.rec.positionMs, seg.endMs) });
      },
      gaps: (gaps) => st.getState().setGaps(gaps),
      segmentsChanged: () => {
        void api.bundle(meetingId).then((b) => {
          st.getState().setSegments(b.segments);
          st.getState().setGaps(b.gaps);
        });
      },
      provider: (provider, attempt) => st.getState().patchRec({ provider, ...(attempt !== undefined ? { attempt } : {}) }),
      persist: (persistOk) => st.getState().patchRec({ persistOk }),
      error: (code, message, fatal) => {
        const text = ERROR_HINTS[code] ?? message;
        st.getState().patchRec({ error: { code, message: text, fatal } });
        if (code !== 'asr_unreachable') toast.error(text);
      },
      storage: (storageOk) => st.getState().patchRec({ storageOk }),
    };
  }, [meetingId]);

  const start = useCallback(async () => {
    const s = useWorkspace.getState();
    const meeting = s.meeting!;
    ref.current?.dispose();
    const demo = meeting.isDemo;
    const buffer = demo
      ? null
      : new MeetingAudioBuffer(meetingId, {
          onError: () => {
            useWorkspace.getState().patchRec({ storageOk: false });
            toast.error('本机录音缓存不可用：转录仍可进行，但断线后无法补录缺失部分。');
          },
        });
    const ringEnd = (await buffer?.latestEnd().catch(() => null)) ?? 0;
    const startPos = Math.max(meeting.recordedMs, ringEnd);
    // A meeting left "interrupted" lost its previous page/connection without a clean pause.
    const resumeReason = meeting.transcriptStatus === 'interrupted' && meeting.recordedMs > 0 ? ('page_reload' as const) : undefined;
    useWorkspace.getState().patchRec({ error: null, positionMs: startPos });
    const tr = new Transcriber({
      meetingId,
      demo,
      startPositionMs: startPos,
      resumeReason,
      capture: demo ? new SyntheticCapture() : new MicCapture(),
      buffer,
      events: events(),
      initialGaps: s.gaps,
    });
    ref.current = tr;
    await tr.start();
  }, [meetingId, events]);

  const pause = useCallback(() => ref.current?.pause(), []);
  const resume = useCallback(async () => {
    if (ref.current) await ref.current.resume();
    else await start();
  }, [start]);

  /** Ends recording, waits for the final sentence to be saved, marks the meeting complete. */
  const end = useCallback(async () => {
    const tr = ref.current;
    if (tr) {
      const r = await tr.end();
      if (!r.clean) toast.info('转录服务未及时确认收尾，可能有最后几秒未能转录；可在复盘页检查。');
    }
    await flushAllNotes(meetingId);
    const { meeting } = await api.endMeeting(meetingId);
    useWorkspace.getState().patchMeeting(meeting);
    useWorkspace.getState().setInterim(null);
    useWorkspace.getState().patchRec({ state: 'ended' });
    return meeting;
  }, [meetingId]);

  const recoverGaps = useCallback(async () => {
    const gaps = useWorkspace.getState().gaps.filter((g) => g.status === 'open');
    if (ref.current) return ref.current.recoverNow();
    let uploaded = 0;
    for (const g of gaps) if ((await recoverGapFromLocalAudio(meetingId, g)) === 'uploaded') uploaded++;
    if (uploaded) toast.info('已提交补录，稍后刷新查看结果');
  }, [meetingId]);

  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      const st = useWorkspace.getState().rec.state;
      if (st === 'recording' || st === 'reconnecting' || st === 'connecting') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    const hide = () => {
      if (document.visibilityState === "hidden") void flushAllNotes(meetingId);
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('visibilitychange', hide);
      ref.current?.dispose();
      ref.current = null;
    };
  }, [meetingId]);

  return {
    start,
    pause,
    resume,
    end,
    recoverGaps,
    demoDropProvider: () => ref.current?.demoDropProvider(),
    simulateNetworkLoss: () => ref.current?.simulateNetworkLoss(),
    get active() {
      return ref.current;
    },
  };
}
