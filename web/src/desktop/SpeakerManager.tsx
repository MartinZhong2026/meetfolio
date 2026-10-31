import { useState } from 'react';
import { Users } from 'lucide-react';
import type { Interview } from './model';
export function SpeakerManager({ i, save }: { i: Interview; save: (change: Partial<Interview>) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const speakers = [...new Set(i.segments.map(s => s.speakerLabel || ''))];
  return <section className="dt-speaker-manager" aria-label="Speaker management">
    <div className="dt-section-title"><Users size={16}/><h3>Speakers</h3><span>{speakers.length}</span></div>
    <p className="dt-fine">Rename a voice throughout this interview. Correct individual turns in the transcript.</p>
    {speakers.map((speaker, n) => <div className="dt-speaker-row" key={speaker}>
      <span className={`dt-speaker-avatar voice-${n % 4}`}>{String(n + 1).padStart(2, '0')}</span>
      {editing === speaker ? <form onSubmit={e => { e.preventDefault(); const label = name.trim(); if (label) { save({ segments: i.segments.map(s => (s.speakerLabel || '') === speaker ? { ...s, speakerLabel: label, updatedAt: new Date().toISOString() } : s) }); setEditing(null); } }}>
        <input aria-label={`Rename ${speaker || 'unlabeled speaker'}`} value={name} maxLength={200} onChange={e => setName(e.target.value)} autoFocus/>
        <button className="dt-small-btn" type="submit">Save name</button><button className="dt-small-btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
      </form> : <><div><strong>{speaker || 'Unlabeled speaker'}</strong><small>{i.segments.filter(s => (s.speakerLabel || '') === speaker).length} turns</small></div><button className="dt-small-btn" aria-label={`Rename ${speaker || 'unlabeled speaker'} throughout interview`} onClick={() => { setEditing(speaker); setName(speaker); }}>Rename</button></>}
    </div>)}
    {!speakers.length && <p className="dt-muted">Voices appear after transcription.</p>}
  </section>;
}
