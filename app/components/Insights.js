"use client";

// Insights dashboard — lazy-loaded, all analytics computed locally & memoized.
// Every card is clickable and jumps into the chat via the shared jump system.

import { useEffect, useMemo, useRef, useState } from "react";
import { formatDate, formatDuration } from "../../lib/chat";
import {
  computeInsightsCached, peekInsightsCache, buildMemoryPool, thisDayInHistory, buildSummaryMarkdown,
  MOODS, TOPICS, LOVE_LANGUAGES,
} from "../../lib/insights";

const hr12 = (h) => `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`;

export default function Insights({ chatName, messages, senders, onJump, onJumpDate, onReplay, onClose }) {
  // Compute after first paint so the overlay + spinner show instantly;
  // cached per chat, so reopening is immediate.
  const [ins, setIns] = useState(() => peekInsightsCache(messages));
  const [customMilestone, setCustomMilestone] = useState("");
  const [memory, setMemory] = useState(null);
  const memPool = useRef(null);

  useEffect(() => {
    if (ins) return;
    const t = setTimeout(() => setIns(computeInsightsCached(messages, senders)), 30);
    return () => clearTimeout(t);
  }, [ins, messages, senders]);

  const thisDay = useMemo(() => (ins ? thisDayInHistory(ins) : []), [ins]);

  if (!ins) {
    return (
      <div className="insights-overlay">
        <div className="insights-head">
          <h2>🧭 Insights — {chatName}</h2>
          <div className="insights-actions"><button className="icon-btn" onClick={onClose}>✕</button></div>
        </div>
        <div className="insights-loading">
          <div className="spinner" />
          <div>Analyzing {messages.length.toLocaleString()} messages…<br /><small>only the first time — cached after this</small></div>
        </div>
      </div>
    );
  }

  const jump = (label, indices, hlRe) => { onClose(); onJump(label, indices, hlRe); };
  const jumpDate = (date) => { onClose(); onJumpDate(date); };

  /* Memory explorer: shuffled pool, no repeats until exhausted */
  const surpriseMe = () => {
    if (!memPool.current || !memPool.current.length) {
      const pool = buildMemoryPool(ins, messages);
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      memPool.current = pool;
    }
    setMemory(memPool.current.pop() || null);
  };

  const searchCustomMilestone = () => {
    const q = customMilestone.trim();
    if (!q) return;
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const hit = ins.real.find((m) => re.test(m.text));
    if (!hit) { alert(`"${q}" not found in this chat.`); return; }
    jump(`🏷 First "${q}"`, [hit.i], new RegExp(re.source, "gi"));
  };

  const downloadSummary = () => {
    const first = ins.real[0]?.date, last = ins.real[ins.real.length - 1]?.date;
    const md = buildSummaryMarkdown(chatName, { first, last }, ins);
    const a = document.createElement("a");
    a.download = `${chatName.replace(/\s+/g, "-")}-summary.md`;
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.click();
  };

  const maxMonth = Math.max(1, ...ins.months.map((m) => m.count));
  const maxVocab = Math.max(1, ...ins.months.map((m) => m.vocab));
  const years = Object.keys(ins.calendar).sort();
  const loveMax = Math.max(1, ...senders.slice(0, 2).flatMap((s) => LOVE_LANGUAGES.map((l) => ins.loveLang[s]?.[l.key] || 0)));

  return (
    <div className="insights-overlay">
      <div className="insights-head">
        <h2>🧭 Insights — {chatName}</h2>
        <div className="insights-actions">
          <button className="ins-btn" onClick={() => { onClose(); onReplay(); }}>▶ Replay chat</button>
          <button className="ins-btn" onClick={downloadSummary}>📄 Summary (.md)</button>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="insights-body">

        {/* ---- Health score ---- */}
        {ins.health && (
          <section className="ins-card">
            <h4>❤️ Conversation health — {ins.health.overall}/100</h4>
            {ins.health.parts.map(([l, v, why]) => (
              <div className="sender-row" key={l}>
                <div className="top"><span>{l} <small className="why">{why}</small></span><span>{v}</span></div>
                <div className="bar-bg"><div className="bar" style={{ width: `${v}%` }} /></div>
              </div>
            ))}
          </section>
        )}

        {/* ---- This day in history ---- */}
        {thisDay.length > 0 && (
          <section className="ins-card">
            <h4>📅 This day in your history</h4>
            {thisDay.map((d) => (
              <div key={d.year} className="milestone clickable" onClick={() => jumpDate(d.date)}>
                <span><b>{d.year}</b> — {d.count} messages{d.note ? ` · ${d.note}` : ""}</span>
                <span className="when">open →</span>
              </div>
            ))}
          </section>
        )}

        {/* ---- Memory explorer ---- */}
        <section className="ins-card">
          <h4>✨ Memory explorer</h4>
          <button className="wrapped-btn" onClick={surpriseMe}>✨ Surprise me</button>
          {memory && (
            <div className="milestone clickable" onClick={() => jump(memory.title, [memory.index])}>
              <span><b>{memory.title}</b> — {memory.detail}</span>
              <span className="when">{formatDate(memory.date)} →</span>
            </div>
          )}
        </section>

        {/* ---- Chapters ---- */}
        <section className="ins-card">
          <h4>📖 Conversation chapters</h4>
          <div className="chapter-strip">
            {ins.chapters.map((c, i) => (
              <div key={i} className="chapter clickable" onClick={() => jump(c.title, [c.startIdx])}>
                <div className="ch-title">{c.title}</div>
                <div className="ch-dates">{formatDate(c.startDate)} → {formatDate(c.endDate)}</div>
                <div className="ch-meta">{c.count.toLocaleString()} msgs · 📎{c.media} · ❤️{c.love}</div>
                <div className="ch-meta">{c.topEmojis.join(" ")} {c.topWords.slice(0, 3).join(" · ")}</div>
                <div className="ch-meta">{Object.entries(c.senders).map(([s, n]) => `${s.split(" ")[0]} ${Math.round((n / c.count) * 100)}%`).join(" · ")}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ---- Mood timeline ---- */}
        <section className="ins-card">
          <h4>🎭 Mood timeline</h4>
          <div className="mood-legend">{MOODS.map((m) => <span key={m.key}><i style={{ background: m.color }} />{m.emoji} {m.label}</span>)}</div>
          <div className="chart mood-chart">
            {ins.months.map((m) => {
              const total = Object.values(m.moods).reduce((s, x) => s + x, 0) || 1;
              const dom = m.dominant ? MOODS.find((x) => x.key === m.dominant[0]) : null;
              return (
                <div key={m.key} className="bar-col"
                  title={`${m.label}: ${m.count} msgs · dominant ${dom ? dom.label : "—"}\n` + Object.entries(m.moodPct).map(([k, v]) => `${MOODS.find((x) => x.key === k)?.emoji} ${v}%`).join("  ")}
                  onClick={() => jump(`🎭 ${m.label}`, [m.firstIdx])}
                >
                  <div className="stacked" style={{ height: `${Math.max(4, (m.count / maxMonth) * 90)}%` }}>
                    {MOODS.map((mood) => m.moods[mood.key] ? (
                      <div key={mood.key} style={{ height: `${(m.moods[mood.key] / total) * 100}%`, background: mood.color }} />
                    ) : null)}
                  </div>
                  <div className="xlab">{dom ? MOODS.find((x) => x.key === m.dominant[0])?.emoji : ""} {m.label}</div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ---- Relationship timeline ---- */}
        <section className="ins-card">
          <h4>💞 Relationship timeline</h4>
          {ins.milestones.map((m) => (
            <div key={m.key} className="milestone clickable" onClick={() => jump(m.label, [m.index], new RegExp(m.re.source, "gi"))}>
              <span>{m.label} <small className="why">{m.sender}: “{m.preview.slice(0, 45)}…”</small></span>
              <span className="when">{formatDate(m.date)}</span>
            </div>
          ))}
          <div className="custom-phrase">
            <input placeholder="Track a custom milestone… e.g. nikah" value={customMilestone}
              onChange={(e) => setCustomMilestone(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchCustomMilestone()} />
            <button className="ins-btn" onClick={searchCustomMilestone}>Find first</button>
          </div>
        </section>

        {/* ---- Nickname evolution ---- */}
        {ins.nicknames.length > 0 && (
          <section className="ins-card">
            <h4>🏷 Nickname evolution</h4>
            <div className="nick-strip">
              {ins.nicknames.map((n, i) => (
                <span key={n.name} className="nick clickable" onClick={() => jump(`🏷 "${n.name}"`, [n.index], new RegExp(`\\b${n.name}\\b`, "gi"))}>
                  {i > 0 && <b className="arrow">→</b>} {n.name} <small>{formatDate(n.date)} · {n.count}×</small>
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ---- Sessions: marathon / silences / fastest ---- */}
        <section className="ins-card">
          <h4>🏃 Conversation records</h4>
          {ins.marathon && (
            <div className="milestone clickable" onClick={() => jump("🏃 Typing marathon", [ins.marathon.startIdx])}>
              <span>🏃 Longest conversation — <b>{ins.marathon.count} messages</b> over {formatDuration(ins.marathon.endTs - ins.marathon.startTs)}
                {ins.marathon.replies ? ` · avg reply ${formatDuration(ins.marathon.replyMs / ins.marathon.replies)}` : ""}</span>
              <span className="when">{formatDate(ins.marathon.date)}</span>
            </div>
          )}
          {ins.fastest.slice(0, 3).map((s, i) => (
            <div key={i} className="milestone clickable" onClick={() => jump("⚡ Fast conversation", [s.startIdx])}>
              <span>⚡ Rapid-fire #{i + 1} — {s.count} msgs · avg reply <b>{formatDuration(s.avgReply)}</b></span>
              <span className="when">{formatDate(s.date)}</span>
            </div>
          ))}
          {ins.silences.slice(0, 3).map((g, i) => (
            <div key={"s" + i} className="milestone clickable" onClick={() => jump("🤫 After the silence", [g.afterIdx])}>
              <span>🤫 Silence #{i + 1} — <b>{formatDuration(g.ms)}</b> of quiet</span>
              <span className="when">{formatDate(g.beforeDate)} → {formatDate(g.afterDate)}</span>
            </div>
          ))}
        </section>

        {/* ---- Energy match + favorite hours ---- */}
        <section className="ins-card">
          <h4>⚡ Energy match</h4>
          {senders.slice(0, 2).map((s) => {
            const e = ins.energy[s] || [0, 0, 0, 0];
            const tot = e.reduce((a, b) => a + b, 0) || 1;
            return (
              <div key={s} className="sender-row">
                <div className="top"><span>{s}</span></div>
                <div className="energy-bar">
                  {["🌅", "☀️", "🌆", "🌙"].map((em, i) => (
                    <div key={i} style={{ width: `${(e[i] / tot) * 100}%` }} title={`${["Morning","Afternoon","Evening","Late night"][i]}: ${Math.round((e[i] / tot) * 100)}%`}>
                      {e[i] / tot > 0.12 ? `${em} ${Math.round((e[i] / tot) * 100)}%` : ""}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="fun-fact" style={{ marginTop: 8 }}>
            ⏰ Most active hour: <b>{hr12(ins.favoriteHours.active.hour)}</b> · 😍 most romantic: <b>{hr12(ins.favoriteHours.romantic.hour)}</b> · 😂 funniest: <b>{hr12(ins.favoriteHours.funny.hour)}</b>
          </div>
        </section>

        {/* ---- Love languages radar ---- */}
        {senders.length >= 2 && (
          <section className="ins-card">
            <h4>💌 Love language detector</h4>
            <Radar senders={senders.slice(0, 2)} loveLang={ins.loveLang} max={loveMax} />
            <div className="fun-fact">
              {senders.slice(0, 2).map((s) => {
                const best = LOVE_LANGUAGES.map((l) => [l, ins.loveLang[s]?.[l.key] || 0]).sort((a, b) => b[1] - a[1])[0];
                return <div key={s}>{best[1] ? <><b>{s}</b>: {best[0].emoji} {best[0].label} ({best[1]} signals)</> : <><b>{s}</b>: not enough signals yet</>}</div>;
              })}
            </div>
          </section>
        )}

        {/* ---- Emotional balance ---- */}
        <section className="ins-card">
          <h4>🤗 Emotional support</h4>
          {senders.slice(0, 2).map((s) => {
            const c = ins.comfort[s];
            return (
              <div key={s}>
                <div className="word-person">{s} comforted {c ? `${c.n}×` : "—"}</div>
                {c?.examples.map((ex, i) => (
                  <div key={i} className="milestone clickable" onClick={() => jump("🤗 Comfort", [ex.index])}>
                    <span>“{ex.text}”</span><span className="when">{formatDate(ex.date)}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </section>

        {/* ---- Topics ---- */}
        <section className="ins-card">
          <h4>🗂 What you talk about</h4>
          <div className="word-chips">
            {TOPICS.filter((t) => ins.topics[t.key]).sort((a, b) => ins.topics[b.key].count - ins.topics[a.key].count).map((t) => (
              <span key={t.key} className="clickable" onClick={() => jump(t.label, ins.topics[t.key].indices, t.re)}>
                {t.label}<small>×{ins.topics[t.key].count}</small>
              </span>
            ))}
          </div>
          {/* topic evolution by year */}
          {Object.keys(ins.byYearTopic).length > 1 && (
            <table className="mini-table" style={{ marginTop: 10 }}><tbody>
              {Object.entries(ins.byYearTopic).sort().map(([yr, tps]) => (
                <tr key={yr}><td><b>{yr}</b></td><td style={{ textAlign: "right", fontWeight: 400 }}>
                  {Object.entries(tps).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => TOPICS.find((t) => t.key === k)?.label).join(" · ")}
                </td></tr>
              ))}
            </tbody></table>
          )}
        </section>

        {/* ---- Emoji evolution ---- */}
        {Object.keys(ins.byYearEmoji).length > 0 && (
          <section className="ins-card">
            <h4>😀 Emoji evolution</h4>
            <table className="mini-table"><tbody>
              {Object.entries(ins.byYearEmoji).sort().map(([yr, em]) => (
                <tr key={yr}><td><b>{yr}</b></td>
                  <td style={{ textAlign: "right", fontSize: 17 }}>
                    {Object.entries(em).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([e]) => e).join(" ")}
                  </td></tr>
              ))}
            </tbody></table>
          </section>
        )}

        {/* ---- Vocabulary growth ---- */}
        <section className="ins-card">
          <h4>📚 Vocabulary growth <small className="why">unique words used each month</small></h4>
          <svg viewBox="0 0 300 80" className="line-chart" preserveAspectRatio="none">
            <polyline fill="none" stroke="var(--accent)" strokeWidth="2"
              points={ins.months.map((m, i) => `${(i / Math.max(1, ins.months.length - 1)) * 296 + 2},${78 - (m.vocab / maxVocab) * 72}`).join(" ")} />
          </svg>
          <div className="axis-labels"><span>{ins.months[0]?.label}</span><span>{ins.months[ins.months.length - 1]?.label}</span></div>
        </section>

        {/* ---- GitHub calendar ---- */}
        <section className="ins-card">
          <h4>🟩 Activity calendar</h4>
          {years.map((yr) => <YearCalendar key={yr} year={yr} days={ins.calendar[yr]} onOpen={jumpDate} />)}
        </section>

        {/* ---- Monthly wrapped ---- */}
        <section className="ins-card">
          <h4>📦 Monthly wrapped</h4>
          <div className="chapter-strip">
            {ins.months.map((m) => (
              <div key={m.key} className="chapter clickable" onClick={() => jump(`📦 ${m.label}`, [m.firstIdx])}>
                <div className="ch-title">{m.label}</div>
                <div className="ch-meta">{m.count.toLocaleString()} msgs · {m.topEmoji} · “{m.topWord}”</div>
                <div className="ch-meta">busiest: {m.busiestDay ? `${formatDate(m.busiestDay[0])} (${m.busiestDay[1]})` : "—"}</div>
                <div className="ch-meta">{m.dominant ? `mood: ${MOODS.find((x) => x.key === m.dominant[0])?.emoji} ${MOODS.find((x) => x.key === m.dominant[0])?.label}` : ""}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ---- Awards ---- */}
        <section className="ins-card">
          <h4>🏅 Awards</h4>
          <div className="award-grid">
            {ins.awards.map((a) => (
              <div key={a.title} className="award">
                <div className="a-emoji">{a.emoji}</div>
                <div><b>{a.title}</b><br /><span>{a.winner}</span><br /><small className="why">{a.detail}</small></div>
              </div>
            ))}
          </div>
        </section>

        {/* ---- Achievements ---- */}
        <section className="ins-card">
          <h4>🎖 Achievements</h4>
          {ins.achievements.map((a) => (
            <div className="sender-row" key={a.label}>
              <div className="top"><span>{a.emoji} {a.label} {a.done ? "✅" : ""}</span><span>{Math.round(a.progress * 100)}%</span></div>
              <div className="bar-bg"><div className="bar" style={{ width: `${a.progress * 100}%`, background: a.done ? "var(--accent)" : "#9aa6ac" }} /></div>
            </div>
          ))}
        </section>

        {/* ---- Personalities ---- */}
        <section className="ins-card">
          <h4>🎭 Personality cards</h4>
          <div className="award-grid">
            {ins.personalities.map((p) => (
              <div key={p.sender} className="award">
                <div className="a-emoji">{p.main.split(" ")[0]}</div>
                <div><b>{p.sender}</b><br /><span>{p.main.slice(p.main.indexOf(" ") + 1)}</span><br /><small className="why">also: {p.second.slice(p.second.indexOf(" ") + 1)}</small></div>
              </div>
            ))}
          </div>
        </section>

        {/* ---- Complexity ---- */}
        <section className="ins-card">
          <h4>🧠 Message complexity</h4>
          <table className="mini-table"><tbody>
            {ins.complexity.map((c) => (
              <tr key={c.sender}><td>{c.sender}</td>
                <td>{c.avgSentence} words/sentence · {c.vocab.toLocaleString()} unique words · richness {c.richness}% · longest sentence {c.longSentence} words</td></tr>
            ))}
          </tbody></table>
        </section>

        {/* ---- Hidden patterns ---- */}
        {ins.patterns.length > 0 && (
          <section className="ins-card">
            <h4>🔍 Hidden patterns</h4>
            {ins.patterns.map(([label, [text, n]]) => (
              <div key={label} className="milestone"><span>{label}</span><span className="when">“{text}” ({n}×)</span></div>
            ))}
          </section>
        )}

        {/* ---- Predictions ---- */}
        <section className="ins-card">
          <h4>🔮 Predictions <small className="why">simple projection from your current pace ({ins.predictions.rate} msgs/day)</small></h4>
          <div className="fun-fact">
            📈 At this pace you&apos;ll send ~<b>{ins.predictions.yearProjection.toLocaleString()}</b> messages in the next year.<br />
            🎯 Message #{ins.predictions.nextRound.toLocaleString()} expected around <b>{ins.predictions.nextRoundDate ? ins.predictions.nextRoundDate.toDateString() : "—"}</b>.<br />
            🎉 Next chat anniversary: <b>{ins.predictions.nextAnniv ? ins.predictions.nextAnniv.toDateString() : "—"}</b> ({ins.predictions.annivYears} years).
          </div>
        </section>

      </div>
    </div>
  );
}

/* ---------- small subcomponents ---------- */

function Radar({ senders, loveLang, max }) {
  const N = LOVE_LANGUAGES.length, cx = 110, cy = 85, R = 65;
  const pt = (i, r) => { const a = (Math.PI * 2 * i) / N - Math.PI / 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
  const poly = (s) => LOVE_LANGUAGES.map((l, i) => pt(i, ((loveLang[s]?.[l.key] || 0) / max) * R).join(",")).join(" ");
  const colors = ["var(--accent)", "#e91e63"];
  return (
    <svg viewBox="0 0 220 170" className="radar">
      {[0.33, 0.66, 1].map((f) => (
        <polygon key={f} points={LOVE_LANGUAGES.map((_, i) => pt(i, R * f).join(",")).join(" ")} fill="none" stroke="var(--border)" strokeWidth="1" />
      ))}
      {senders.map((s, si) => (
        <polygon key={s} points={poly(s)} fill={colors[si]} fillOpacity=".25" stroke={colors[si]} strokeWidth="2" />
      ))}
      {LOVE_LANGUAGES.map((l, i) => {
        const [x, y] = pt(i, R + 14);
        return <text key={l.key} x={x} y={y} textAnchor="middle" fontSize="9" fill="var(--text-secondary)">{l.emoji} {l.label.split(" ")[0]}</text>;
      })}
    </svg>
  );
}

function YearCalendar({ year, days, onOpen }) {
  const byDate = {};
  let maxN = 1;
  for (const d of days) { byDate[d.ts] = d; if (d.count > maxN) maxN = d.count; }
  const start = new Date(+year, 0, 1);
  const startDow = start.getDay();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let t = start.getTime(); new Date(t).getFullYear() === +year; t += 86400000) cells.push({ ts: t, d: byDate[t] });
  return (
    <div className="cal-year">
      <div className="cal-label">{year}</div>
      <div className="cal-grid">
        {cells.map((c, i) => c === null ? <i key={i} /> : (
          <i key={i}
            className={c.d ? "on clickable" : ""}
            title={`${new Date(c.ts).toDateString()}${c.d ? ` — ${c.d.count} messages` : ""}`}
            style={c.d ? { background: `rgba(var(--accent-rgb), ${0.25 + 0.75 * (c.d.count / maxN)})` } : {}}
            onClick={() => c.d && onOpen(c.d.date)}
          />
        ))}
      </div>
    </div>
  );
}
