"use client";

// Chat Replay — plays the conversation back like a movie with speed control,
// typing indicator, seek bar and auto-scroll. Fully client-side.

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate, escapeHtml, formatText, isEmojiOnly } from "../../lib/chat";

const SPEEDS = [1, 2, 5, 10, 20];

export default function Replay({ chatName, messages, me, onClose }) {
  const real = useMemo(() => messages.map((m, i) => ({ ...m, i })).filter((m) => !m.system), [messages]);
  const [pos, setPos] = useState(0);          // how many messages are shown
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(5);
  const [typing, setTyping] = useState(null); // sender currently "typing"
  const boxRef = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!playing || pos >= real.length) { setTyping(null); return; }
    const next = real[pos];
    const typeMs = Math.min(1400, 250 + next.text.length * 12) / speed;
    setTyping(next.sender);
    timer.current = setTimeout(() => {
      setTyping(null);
      setPos((p) => p + 1);
    }, typeMs + 120 / speed);
    return () => clearTimeout(timer.current);
  }, [playing, pos, speed, real]);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [pos, typing]);

  const shown = real.slice(Math.max(0, pos - 80), pos); // window of last 80 for performance
  let lastDate = shown.length ? real[Math.max(0, pos - 81)]?.date : null;

  return (
    <div className="replay-overlay">
      <div className="replay-head">
        <h3>▶ Replay — {chatName}</h3>
        <button className="icon-btn" onClick={onClose}>✕</button>
      </div>
      <div className="chat replay-chat" ref={boxRef}>
        {shown.map((m) => {
          const showDivider = m.date !== lastDate;
          lastDate = m.date;
          const out = m.sender === me;
          return (
            <div key={m.i}>
              {showDivider && <div className="day-divider"><span>{formatDate(m.date)}</span></div>}
              <div className={`row ${out ? "out" : "in"} first pop`}>
                <div className="bubble">
                  <span className={`msg-text${isEmojiOnly(m.text) ? " emoji-only" : ""}`} dangerouslySetInnerHTML={{ __html: formatText(m.text) }} />
                  <span className="meta">{escapeHtml(m.time)}{out ? " ✓✓" : ""}</span>
                </div>
              </div>
            </div>
          );
        })}
        {typing && (
          <div className={`row ${typing === me ? "out" : "in"} first`}>
            <div className="bubble typing"><span /><span /><span /></div>
          </div>
        )}
        {pos >= real.length && <div className="day-divider"><span>🎬 The End — {real.length.toLocaleString()} messages</span></div>}
      </div>
      <div className="replay-controls">
        <button className="ins-btn" onClick={() => setPlaying((p) => !p)}>{playing ? "⏸ Pause" : pos >= real.length ? "↺ Restart" : "▶ Play"}</button>
        {pos >= real.length && <button className="ins-btn" onClick={() => { setPos(0); setPlaying(true); }}>↺</button>}
        <input
          type="range" min="0" max={real.length} value={pos}
          onChange={(e) => { setPos(+e.target.value); }}
          className="seek"
        />
        <span className="replay-count">{pos.toLocaleString()} / {real.length.toLocaleString()}</span>
        {SPEEDS.map((s) => (
          <button key={s} className={`ins-btn speed${speed === s ? " on" : ""}`} onClick={() => setSpeed(s)}>{s}x</button>
        ))}
      </div>
    </div>
  );
}
