import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Segment } from '../lib/types';
import { fmtClock } from '../lib/format';
import { localRuntime } from './runtime';
import { initialPlaybackState, SegmentPlayer } from './segmentPlayer';

export interface SegmentPlaybackHandle { play(segment: Segment): void }
export const SegmentPlayback = forwardRef<SegmentPlaybackHandle, { interviewId: string }>(function SegmentPlayback({ interviewId }, ref) {
  const player = useRef<SegmentPlayer | null>(null);
  const [state, setState] = useState(initialPlaybackState);
  useEffect(() => {
    const instance = new SegmentPlayer(localRuntime(), interviewId, setState);
    player.current = instance;
    setState(initialPlaybackState);
    return () => { instance.dispose(); player.current = null; };
  }, [interviewId]);
  useImperativeHandle(ref, () => ({ play: segment => { void player.current?.play(segment); } }), []);
  return <div className="dt-playback" aria-label="Segment audio playback" role="region">
    <p role="status" aria-live="polite">{state.status === 'idle' ? 'Select linked transcript text to hear the original audio.' : `Segment ${state.seq} · ${state.status}`}</p>
    {state.segmentId && <>
      <progress aria-label="Segment audio progress" value={state.positionMs} max={state.durationMs || 1}/>
      <span className="dt-fine"> {fmtClock(state.positionMs)} / {fmtClock(state.durationMs)}</span>
      <div className="dt-actions">
        {state.status === 'playing' && <button className="dt-small-btn" onClick={() => player.current?.pause()}>Pause audio</button>}
        {state.status === 'paused' && <button className="dt-small-btn" onClick={() => void player.current?.resume()}>Resume audio</button>}
        <button className="dt-small-btn" onClick={() => player.current?.stop()}>Stop audio</button>
      </div>
    </>}
    {state.message && <p role={state.status === 'error' ? 'alert' : 'status'}>{state.message}</p>}
  </div>;
});
