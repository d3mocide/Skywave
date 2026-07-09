// Time-preview control — lives in the top bar (UI-UX-PLAN.md Phase 2)
// rather than floating over the map, so it reads as "what time am I
// looking at" for the whole view instead of a map-only overlay. Drives
// propagation previews and the map's sun-driven layers up to 24 h ahead;
// live data feeds always stay live regardless of the preview offset.

import { useEffect, useState } from 'react';

export function TimeScrubber(props: {
  scrubHours: number;
  onScrub: (hours: number) => void;
  time: Date;
}) {
  const { scrubHours, onScrub, time } = props;
  const previewing = scrubHours !== 0;

  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      onScrub(scrubHours >= 24 ? 0 : Math.round((scrubHours + 0.5) * 2) / 2);
    }, 400);
    return () => clearInterval(id);
  }, [playing, scrubHours, onScrub]);

  return (
    <div className="scrubber" title="preview propagation & map up to 24 h ahead">
      <button
        type="button"
        className="scrubber-btn"
        onClick={() => setPlaying((p) => !p)}
        title={playing ? 'pause' : 'play the next 24 h'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <button
        type="button"
        className={`scrubber-btn ${previewing ? '' : 'scrubber-live'}`}
        onClick={() => {
          setPlaying(false);
          onScrub(0);
        }}
        title="back to live"
      >
        now
      </button>
      <input
        type="range"
        min={0}
        max={24}
        step={0.5}
        value={scrubHours}
        onChange={(e) => onScrub(Number(e.target.value))}
        aria-label="preview time, hours ahead"
      />
      <span className={`scrubber-label mono ${previewing ? 'previewing' : ''}`}>
        {previewing ? `+${scrubHours}h · ${time.toISOString().slice(11, 16)}Z` : 'live'}
      </span>
    </div>
  );
}
