// ---------- Deep analytics for the Insights dashboard ----------
// Everything is rule-based, offline, computed locally. One heavy pass + a few
// secondary passes; results are memoized by the caller (computed once per chat).

import { toTimestamp, toJsDate, formatDate, formatDuration, dateParts } from "./chat";

const HOUR = 3600000, DAY = 86400000;
const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ================= lexicons ================= */

export const MOODS = [
  { key: "happy",    label: "Happy",    emoji: "😊", color: "#f6c344", re: /\b(happy|khush|great|yay|awesome|amazing|alhamdulillah|mashallah)\b|😊|😁|🙂|😄|☺️/gi },
  { key: "funny",    label: "Funny",    emoji: "😂", color: "#4fc3f7", re: /\b(haha+|hehe+|lol|lmao|rofl|funny|mazak|mazaq)\b|😂|🤣|😆/gi },
  { key: "romantic", label: "Romantic", emoji: "😍", color: "#ec6a9c", re: /\b(love|pyaa?r|mohabbat|jaan|jaanu|habibi|beautiful|cute|miss (you|u))\b|😍|❤️|💕|😘|🥰|💖|💞/gi },
  { key: "sad",      label: "Sad",      emoji: "😢", color: "#7986cb", re: /\b(sad|cry(ing)?|udaas|rona|dukh|hurt|akela|alone|tears)\b|😢|😭|💔|😞|☹️/gi },
  { key: "angry",    label: "Angry",    emoji: "😡", color: "#ef5350", re: /\b(angry|gussa|naraz|hate|stupid|pagal|annoyed|ugh)\b|😡|😠|🤬/gi },
  { key: "worried",  label: "Worried",  emoji: "😰", color: "#9575cd", re: /\b(worried|tension|pareshan|fikar|scared|dar|anxious|nervous)\b|😰|😟|😨|😧/gi },
  { key: "tired",    label: "Tired",    emoji: "😴", color: "#90a4ae", re: /\b(tired|thaka?|neend|sleepy|so (rha|rhi|raha|rahi)|exhausted|sona)\b|😴|🥱|😪/gi },
];

const COMFORT_RE = /\b(don'?t worry|fikar (na|mat)|i'?m here|take care|khayal rakh|rest|aram|it'?s ok(ay)?|sab (theek|thik)|hope|inshallah|hausla|himmat|strong|dua)\b/gi;

export const TOPICS = [
  { key: "food",    label: "Food 🍕",       re: /\b(food|khana|lunch|dinner|breakfast|biryani|pizza|burger|chai|coffee|restaurant|bhook|hungry|recipe)\b/gi },
  { key: "travel",  label: "Travel ✈️",     re: /\b(travel|trip|safar|vacation|flight|ticket|hotel|beach|mountain|murree|dubai|visa|tour)\b/gi },
  { key: "family",  label: "Family 👨‍👩‍👧",   re: /\b(family|ammi|abbu|mama|papa|bhai|behan|sister|brother|khala|chacha|dadi|nani|ghar wal[eo])\b/gi },
  { key: "work",    label: "Work 💼",       re: /\b(work|office|job|boss|meeting|salary|client|project|kaam|interview|overtime)\b/gi },
  { key: "study",   label: "Study 🎓",      re: /\b(university|uni|college|school|exam|paper|assignment|quiz|semester|degree|class|lecture|study|parhai)\b/gi },
  { key: "shopping",label: "Shopping 🛍",   re: /\b(shopping|buy|kharid|order|sale|price|bazaar|mall|dress|shoes|online order)\b/gi },
  { key: "movies",  label: "Movies 🎬",     re: /\b(movie|film|drama|episode|season|netflix|series|watch(ing)?|cinema)\b/gi },
  { key: "games",   label: "Games 🎮",      re: /\b(game|gaming|pubg|fortnite|fifa|play(ing)? (game|pubg)|match jeet|rank)\b/gi },
  { key: "religion",label: "Religion 🕌",   re: /\b(namaz|prayer|dua|quran|ramzan|ramadan|eid|jummah|masjid|roza|allah)\b/gi },
  { key: "health",  label: "Health 🏥",     re: /\b(doctor|hospital|medicine|dawai|fever|bukhar|sick|bimar|pain|dard|checkup|gym|exercise)\b/gi },
  { key: "tech",    label: "Technology 💻", re: /\b(phone|mobile|laptop|computer|app|software|code|coding|internet|wifi|update|iphone|android)\b/gi },
  { key: "money",   label: "Money 💰",      re: /\b(money|paisa|paise|bank|account|loan|udhar|bill|rent|invest)\b/gi },
];

export const LOVE_LANGUAGES = [
  { key: "words",   label: "Words of Affirmation", emoji: "💬", re: /\b(love (you|u)|proud of (you|u)|beautiful|handsome|cute|best|amazing|jaan|pyaa?r|mohabbat|miss (you|u))\b|❤️|😍|😘/gi },
  { key: "service", label: "Acts of Service",      emoji: "🤝", re: /\b(i('| wi)ll (do|help|make|bring|pick|drop|send)|kar (dun|dunga|dungi)|le aun|bhej (dun|deta|deti)|help kar|done for you)\b/gi },
  { key: "time",    label: "Quality Time",         emoji: "⏰", re: /\b(let'?s (meet|go|watch)|milte|chalein|call kar|video call|spend time|sath|together|date)\b/gi },
  { key: "gifts",   label: "Gift Giving",          emoji: "🎁", re: /\b(gift|tohfa|surprise|bought (you|u)|le (liya|li) (tum|ap)|present|flowers)\b|🎁|💐/gi },
  { key: "touch",   label: "Physical Touch",       emoji: "🤗", re: /\b(hug|hold (you|u|hands)|cuddle|kiss|gale)\b|🤗|😘|💋/gi },
];

const NICKNAMES = ["dear","friend","buddy","bro","yaar","dost","jaan","jaanu","janu","baby","babe","jaanam","janam","sweetheart","my love","darling","habibi","begum","wifey","hubby","shona","cutie"];

const MILESTONE_DEFS = [
  { key: "ily",     label: '❤️ First "I love you"', re: /i\s*love\s*(you|u)\b|\bily\b/i },
  { key: "heart",   label: "💕 First heart emoji",  re: /❤️|❤|💕|💖|💞|🥰|😍/ },
  { key: "jaan",    label: '🥰 First "jaan"',       re: /\bjaan\b|\bjaanu\b|\bjanu\b/i },
  { key: "bday",    label: "🎂 First birthday wish",re: /happy\s*birthday|\bhbd\b|salgirah/i },
  { key: "trip",    label: "✈️ First trip talk",    re: /\b(trip|safar|vacation|flight|travel plan)\b/i },
  { key: "house",   label: "🏠 House talk",         re: /\b(new (house|home|ghar)|shift (ho|kar)|apartment|flat le)\b/i },
  { key: "proposal",label: "💍 Proposal / shadi",   re: /\b(propos(e|al)|shadi|nikah|rishta|marry|marriage|mangni|engagement)\b/i },
  { key: "baby",    label: "👶 Baby talk",          re: /\b(baby (on the way|aane|hoga)|pregnant|mubarak.*(beta|beti)|newborn)\b/i },
  { key: "grad",    label: "🎓 Graduation",         re: /\b(graduat(e|ed|ion)|convocation|degree (mil|complete))\b/i },
  { key: "job",     label: "💼 New job",            re: /\b(job (mil|lag)|got the job|offer letter|new job|first day at (work|office))\b/i },
];

const GREET_RE = /^(hi+|hey+|hello+|salam|asalam|assalam|aoa|slm|good morning|gm)\b/i;
const BYE_RE = /\b(good ?night|gn|bye+|allah hafiz|khuda hafiz|tc|take care|talk (to you )?later|ttyl|sone (ja|lag))\b/i;

const STOP_SHORT = new Set("the a an and or to of in is it i you me my na ni ok han haan g ji hai ha kya ko ka ki se sy ap tum wo ye bhi aur nhi nahi".split(" "));

/* ================= helpers ================= */

const norm = (t) => t.toLowerCase().replace(/[^\w\s؀-ۿ]/g, "").replace(/\s+/g, " ").trim();
const isMedia = (t) => /<Media omitted>|omitted$/i.test(t.trim());
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (k) => { const [y, m] = k.split("-"); return `${MONTHS_SHORT[+m - 1]} ${y.slice(2)}`; };
const top = (obj, n = 1) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);

function countMatches(re, t) { re.lastIndex = 0; const m = t.match(re); return m ? m.length : 0; }

/* ================= main computation ================= */

// Cache: insights computed once per chat; reopening the dashboard is instant.
const insightsCache = new WeakMap();
export function computeInsightsCached(messages, senders) {
  if (insightsCache.has(messages)) return insightsCache.get(messages);
  const r = computeInsights(messages, senders);
  insightsCache.set(messages, r);
  return r;
}
export function peekInsightsCache(messages) {
  return insightsCache.get(messages) || null;
}

export function computeInsights(messages, senders) {
  const real = [];
  messages.forEach((m, i) => { if (!m.system) real.push({ ...m, i, ts: toTimestamp(m) }); });
  if (!real.length) return null;
  const [A, B] = senders;

  // ---- per-message accumulators ----
  const byMonth = {};            // key -> {count, moods{}, loveN, firstIdx, words{}, emojis{}, days{}, senders{}}
  const byYearEmoji = {};        // year -> emoji counts
  const byYearTopic = {};        // year -> topic counts
  const vocabByMonth = {};       // key -> Set
  const dayCounts = {};          // date str -> {count, firstIdx, romantic, funny}
  const hourStats = { active: Array(24).fill(0), romantic: Array(24).fill(0), funny: Array(24).fill(0), happy: Array(24).fill(0) };
  const energy = {};             // sender -> [morning, afternoon, evening, night]
  const loveLang = {};           // sender -> {key: n}
  const comfort = {};            // sender -> {n, examples[]}
  const topics = {};             // key -> {count, indices[], byYear{}}
  const nickFirst = {};          // nickname -> {index, date, sender, count}
  const greet = {}, bye = {}, afterIly = {}, questions = {}, lateNight = {}, firstMsgOfDay = {};
  const moodTotals = {};
  let mediaTotal = 0;
  const perSender = {};          // sender -> {msgs, words, sentences, longSentence, vocab:Set, emojis, hearts, questions, night, gm, essays, funny, romantic, support}

  const milestones = [];
  const mseen = {};
  let prevDayStr = null, prevMsg = null;

  for (const m of real) {
    const t = m.text;
    const media = isMedia(t);
    if (media) mediaTotal++;
    const d = m.ts != null ? new Date(m.ts) : toJsDate(m.date);
    const mk = d ? monthKey(d) : "unknown";
    const yr = d ? d.getFullYear() : 0;
    const hr = d ? d.getHours() : 12;

    const ps = (perSender[m.sender] = perSender[m.sender] || { msgs: 0, words: 0, sentences: 0, longSentence: 0, vocab: new Set(), emojis: 0, hearts: 0, questions: 0, night: 0, gm: 0, funny: 0, romantic: 0, support: 0 });
    ps.msgs++;

    const bm = (byMonth[mk] = byMonth[mk] || { count: 0, moods: {}, loveN: 0, firstIdx: m.i, words: {}, emojis: {}, senders: {}, days: {}, label: monthLabel(mk), key: mk });
    bm.count++; bm.senders[m.sender] = (bm.senders[m.sender] || 0) + 1;
    bm.days[m.date] = (bm.days[m.date] || 0) + 1;

    const dc = (dayCounts[m.date] = dayCounts[m.date] || { count: 0, firstIdx: m.i, romantic: 0, funny: 0, emojis: 0, media: 0, ts: d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() : 0 });
    dc.count++;
    if (media) dc.media++;

    if (m.date !== prevDayStr) {
      const n = norm(t).slice(0, 40);
      if (n) firstMsgOfDay[n] = (firstMsgOfDay[n] || 0) + 1;
      if (prevMsg) { const bn = norm(prevMsg.text).slice(0, 40); if (bn && BYE_RE.test(prevMsg.text)) bye[bn] = (bye[bn] || 0) + 1; }
      prevDayStr = m.date;
    }
    if (GREET_RE.test(t)) { const n = norm(t).slice(0, 30); greet[n] = (greet[n] || 0) + 1; if (/morning|gm\b/i.test(t)) ps.gm++; }
    if (/\?\s*$/.test(t.trim())) { ps.questions++; const n = norm(t).slice(0, 50); if (n) questions[n] = (questions[n] || 0) + 1; }
    if (hr >= 0 && hr < 5) { ps.night++; const n = norm(t).slice(0, 40); if (n && !media) lateNight[n] = (lateNight[n] || 0) + 1; }
    if (prevMsg && /i\s*love\s*(you|u)\b/i.test(prevMsg.text) && m.sender !== prevMsg.sender) {
      const n = norm(t).slice(0, 40);
      if (n) afterIly[n] = (afterIly[n] || 0) + 1;
    }

    if (!media) {
      // moods
      for (const mood of MOODS) {
        const n = countMatches(mood.re, t);
        if (n) {
          bm.moods[mood.key] = (bm.moods[mood.key] || 0) + n;
          moodTotals[mood.key] = (moodTotals[mood.key] || 0) + n;
          if (mood.key === "romantic") { dc.romantic += n; hourStats.romantic[hr] += n; ps.romantic += n; bm.loveN += n; }
          if (mood.key === "funny") { dc.funny += n; hourStats.funny[hr] += n; ps.funny += n; }
          if (mood.key === "happy") hourStats.happy[hr] += n;
        }
      }
      hourStats.active[hr]++;
      // energy buckets: 5-12 / 12-17 / 17-22 / 22-5
      const bucket = hr >= 5 && hr < 12 ? 0 : hr >= 12 && hr < 17 ? 1 : hr >= 17 && hr < 22 ? 2 : 3;
      (energy[m.sender] = energy[m.sender] || [0, 0, 0, 0])[bucket]++;
      // love languages
      for (const l of LOVE_LANGUAGES) {
        const n = countMatches(l.re, t);
        if (n) (loveLang[m.sender] = loveLang[m.sender] || {})[l.key] = ((loveLang[m.sender] || {})[l.key] || 0) + n;
      }
      // comfort
      const cn = countMatches(COMFORT_RE, t);
      if (cn) {
        const c = (comfort[m.sender] = comfort[m.sender] || { n: 0, examples: [] });
        c.n += cn; ps.support += cn;
        if (c.examples.length < 3) c.examples.push({ index: m.i, text: t.slice(0, 90), date: m.date });
      }
      // topics
      for (const tp of TOPICS) {
        const n = countMatches(tp.re, t);
        if (n) {
          const rec = (topics[tp.key] = topics[tp.key] || { count: 0, indices: [], byYear: {} });
          rec.count += n;
          if (rec.indices.length < 400) rec.indices.push(m.i);
          rec.byYear[yr] = (rec.byYear[yr] || 0) + n;
          (byYearTopic[yr] = byYearTopic[yr] || {})[tp.key] = (byYearTopic[yr][tp.key] || 0) + n;
        }
      }
      // nicknames
      const low = " " + t.toLowerCase() + " ";
      for (const nn of NICKNAMES) {
        if (low.includes(" " + nn + " ") || low.includes(" " + nn + ",") || low.includes(" " + nn + "!")) {
          const rec = (nickFirst[nn] = nickFirst[nn] || { index: m.i, date: m.date, sender: m.sender, count: 0 });
          rec.count++;
        }
      }
      // words / vocab / emojis / complexity
      const words = t.toLowerCase().replace(/https?:\/\/\S+/g, " ").split(/[^a-z؀-ۿ']+/).filter((w) => w.length > 2 && !STOP_SHORT.has(w));
      ps.words += words.length;
      const sentences = t.split(/[.!?\n]+/).filter((s) => s.trim().length > 1);
      ps.sentences += sentences.length || 1;
      for (const s of sentences) { const wc = s.trim().split(/\s+/).length; if (wc > ps.longSentence) ps.longSentence = wc; }
      const vset = (vocabByMonth[mk] = vocabByMonth[mk] || new Set());
      for (const w of words) { vset.add(w); ps.vocab.add(w); bm.words[w] = (bm.words[w] || 0) + 1; }
      try {
        for (const e of t.match(/\p{Extended_Pictographic}/gu) || []) {
          ps.emojis++; dc.emojis++;
          bm.emojis[e] = (bm.emojis[e] || 0) + 1;
          (byYearEmoji[yr] = byYearEmoji[yr] || {})[e] = (byYearEmoji[yr][e] || 0) + 1;
          if (/❤|💕|💖|💞|💗|💓/.test(e)) ps.hearts++;
        }
      } catch {}
      // milestones (first occurrence)
      for (const md of MILESTONE_DEFS) {
        if (!mseen[md.key] && md.re.test(t)) {
          mseen[md.key] = true;
          milestones.push({ ...md, index: m.i, date: m.date, sender: m.sender, preview: t.slice(0, 80) });
        }
      }
    }
    prevMsg = m;
  }

  /* ---- sessions: conversations separated by >30min gaps ---- */
  const sessions = [];
  let cur = null;
  const gaps = [];
  for (let k = 0; k < real.length; k++) {
    const m = real[k];
    if (m.ts == null) continue;
    if (cur && m.ts - cur.endTs <= 30 * 60000) {
      cur.count++; cur.endTs = m.ts; cur.endIdx = m.i;
      if (m.sender !== cur.lastSender) { cur.replies++; cur.replyMs += m.ts - cur.lastTs; }
      cur.lastSender = m.sender; cur.lastTs = m.ts; cur.senders.add(m.sender);
    } else {
      if (cur) { sessions.push(cur); gaps.push({ ms: m.ts - cur.endTs, beforeIdx: cur.endIdx, afterIdx: m.i, beforeDate: real[k - 1]?.date, afterDate: m.date }); }
      cur = { startTs: m.ts, endTs: m.ts, startIdx: m.i, endIdx: m.i, count: 1, replies: 0, replyMs: 0, lastSender: m.sender, lastTs: m.ts, senders: new Set([m.sender]), date: m.date };
    }
  }
  if (cur) sessions.push(cur);
  const marathon = sessions.reduce((best, s) => (!best || s.endTs - s.startTs > best.endTs - best.startTs ? s : best), null);
  const silences = gaps.sort((a, b) => b.ms - a.ms).slice(0, 5);
  const fastest = sessions.filter((s) => s.count >= 20 && s.replies >= 8)
    .map((s) => ({ ...s, avgReply: s.replyMs / Math.max(1, s.replies) }))
    .sort((a, b) => a.avgReply - b.avgReply).slice(0, 5);

  /* ---- chapters: split on ≥21-day gaps or new year ---- */
  const chapters = [];
  let ch = null;
  for (const m of real) {
    const d = m.ts != null ? new Date(m.ts) : toJsDate(m.date);
    const yr = d ? d.getFullYear() : 0;
    const newChapter = !ch || (m.ts != null && ch.lastTs != null && m.ts - ch.lastTs > 21 * DAY) || (ch.year && yr !== ch.year && ch.count > 200);
    if (newChapter) {
      if (ch) chapters.push(ch);
      ch = { startIdx: m.i, startDate: m.date, year: yr, count: 0, senders: {}, words: {}, emojis: {}, days: {}, love: 0, sorry: 0, media: 0, lastTs: m.ts };
    }
    ch.count++; ch.endDate = m.date; ch.lastTs = m.ts ?? ch.lastTs;
    ch.senders[m.sender] = (ch.senders[m.sender] || 0) + 1;
    ch.days[m.date] = (ch.days[m.date] || 0) + 1;
    const t = m.text;
    if (isMedia(t)) { ch.media++; continue; }
    ch.love += countMatches(MOODS[2].re, t);
    if (/\bsorry\b|\bmaaf\b|\bsry\b/i.test(t)) ch.sorry++;
    try { for (const e of t.match(/\p{Extended_Pictographic}/gu) || []) ch.emojis[e] = (ch.emojis[e] || 0) + 1; } catch {}
    for (const w of t.toLowerCase().split(/[^a-z؀-ۿ']+/)) if (w.length > 3 && !STOP_SHORT.has(w)) ch.words[w] = (ch.words[w] || 0) + 1;
  }
  if (ch) chapters.push(ch);
  chapters.forEach((c, ci) => {
    const loveRate = c.love / c.count, mediaRate = c.media / c.count, sorryRate = c.sorry / c.count;
    let title;
    if (ci === 0) title = "🌱 The Beginning";
    else if (loveRate > 0.08) title = "💕 Honeymoon Phase";
    else if (sorryRate > 0.03) title = "🌧 Rough Patch";
    else if (mediaRate > 0.25) title = "📸 Picture Days";
    else if (c.count / Math.max(1, Object.keys(c.days).length) > 120) title = "🔥 Non-stop Talking";
    else if (Object.keys(c.days).length < 6) title = "⚡ A Short Spark";
    else title = `📖 Chapter ${ci + 1}`;
    c.title = `${title} · ${c.year || ""}`;
    c.topWords = top(c.words, 4).map(([w]) => w);
    c.topEmojis = top(c.emojis, 4).map(([e]) => e);
    c.busiestDay = top(c.days, 1)[0] || null;
  });

  /* ---- month list (sorted) with moods & wrapped info ---- */
  const months = Object.values(byMonth).sort((a, b) => a.key.localeCompare(b.key));
  months.forEach((bm) => {
    const totalMood = Object.values(bm.moods).reduce((s, x) => s + x, 0) || 1;
    bm.dominant = top(bm.moods, 1)[0] || null;
    bm.moodPct = Object.fromEntries(Object.entries(bm.moods).map(([k, v]) => [k, Math.round((v / totalMood) * 100)]));
    bm.topWord = top(bm.words, 1)[0]?.[0] || "—";
    bm.topEmoji = top(bm.emojis, 1)[0]?.[0] || "—";
    bm.busiestDay = top(bm.days, 1)[0] || null;
    bm.vocab = vocabByMonth[bm.key]?.size || 0;
  });

  /* ---- awards ---- */
  const awards = [];
  const bySender = (fn, pick = "max") => {
    const es = senders.map((s) => [s, fn(perSender[s] || {}, s)]).filter((x) => x[1] > 0);
    if (!es.length) return null;
    es.sort((a, b) => (pick === "max" ? b[1] - a[1] : a[1] - b[1]));
    return es[0];
  };
  const addAward = (emoji, title, winner, detail) => winner && awards.push({ emoji, title, winner: winner[0], detail: detail(winner[1]) });
  addAward("🌙", "Night Owl", bySender((p) => p.night), (v) => `${v} late-night messages`);
  addAward("😂", "The Comedian", bySender((p) => p.funny), (v) => `${v} funny moments`);
  addAward("❤️", "Heart Sender", bySender((p) => p.hearts), (v) => `${v} hearts sent`);
  addAward("📝", "Essay Writer", bySender((p) => (p.msgs ? p.words / p.msgs : 0)), (v) => `${v.toFixed(1)} words per message avg`);
  addAward("😍", "The Romantic", bySender((p) => p.romantic), (v) => `${v} romantic messages`);
  addAward("🤗", "The Supporter", bySender((p) => p.support), (v) => `${v} comforting messages`);
  addAward("❓", "Question Master", bySender((p) => p.questions), (v) => `${v} questions asked`);
  addAward("☀️", "Good Morning Champion", bySender((p) => p.gm), (v) => `${v} morning greetings`);
  addAward("😀", "Emoji Champion", bySender((p) => p.emojis), (v) => `${v} emojis used`);

  /* ---- achievements ---- */
  const totalMsgs = real.length;
  const totalHearts = senders.reduce((s, x) => s + (perSender[x]?.hearts || 0), 0);
  const totalEmojis = senders.reduce((s, x) => s + (perSender[x]?.emojis || 0), 0);
  const sorryTotal = chapters.reduce((s, c) => s + c.sorry, 0);
  const dayKeys = Object.keys(dayCounts);
  const achievements = [
    { emoji: "💬", label: "1,000 messages", done: totalMsgs >= 1000, progress: Math.min(1, totalMsgs / 1000) },
    { emoji: "🚀", label: "10,000 messages", done: totalMsgs >= 10000, progress: Math.min(1, totalMsgs / 10000) },
    { emoji: "🏆", label: "100,000 messages", done: totalMsgs >= 100000, progress: Math.min(1, totalMsgs / 100000) },
    { emoji: "❤️", label: "1,000 hearts", done: totalHearts >= 1000, progress: Math.min(1, totalHearts / 1000) },
    { emoji: "😀", label: "1,000 emojis", done: totalEmojis >= 1000, progress: Math.min(1, totalEmojis / 1000) },
    { emoji: "🙏", label: "100 apologies", done: sorryTotal >= 100, progress: Math.min(1, sorryTotal / 100) },
    { emoji: "📅", label: "365 active days", done: dayKeys.length >= 365, progress: Math.min(1, dayKeys.length / 365) },
  ];

  /* ---- personalities ---- */
  const personalities = senders.map((s) => {
    const p = perSender[s] || {};
    const scores = [
      ["😍 The Romantic", p.romantic || 0],
      ["😂 The Comedian", p.funny || 0],
      ["👂 The Listener", (p.questions || 0) * 2],
      ["📖 The Storyteller", p.msgs ? (p.words / p.msgs) * 10 : 0],
      ["🌙 The Night Owl", (p.night || 0) * 1.5],
      ["💪 The Motivator", (p.support || 0) * 3],
    ].sort((a, b) => b[1] - a[1]);
    return { sender: s, main: scores[0][0], second: scores[1][0] };
  });

  /* ---- complexity ---- */
  const complexity = senders.map((s) => {
    const p = perSender[s] || {};
    return {
      sender: s,
      avgSentence: p.sentences ? +(p.words / p.sentences).toFixed(1) : 0,
      richness: p.words ? +((p.vocab.size / p.words) * 100).toFixed(1) : 0,
      vocab: p.vocab.size,
      longSentence: p.longSentence,
    };
  });

  /* ---- predictions ---- */
  const firstTs = real.find((m) => m.ts != null)?.ts;
  const lastTs = [...real].reverse().find((m) => m.ts != null)?.ts;
  const spanDaysN = firstTs && lastTs ? Math.max(1, (lastTs - firstTs) / DAY) : 1;
  const rate = totalMsgs / spanDaysN;
  const nextRound = totalMsgs < 100000 ? Math.ceil(totalMsgs / 50000) * 50000 : Math.ceil((totalMsgs + 1) / 100000) * 100000;
  const firstD = firstTs ? new Date(firstTs) : null;
  let nextAnniv = null;
  if (firstD) {
    const now = new Date();
    nextAnniv = new Date(now.getFullYear(), firstD.getMonth(), firstD.getDate());
    if (nextAnniv < now) nextAnniv.setFullYear(now.getFullYear() + 1);
  }
  const predictions = {
    rate: +rate.toFixed(1),
    nextRound,
    nextRoundDate: rate > 0 && lastTs ? new Date(lastTs + ((nextRound - totalMsgs) / rate) * DAY) : null,
    nextAnniv,
    annivYears: firstD && nextAnniv ? nextAnniv.getFullYear() - firstD.getFullYear() : 0,
    yearProjection: Math.round(rate * 365),
  };

  /* ---- health score ---- */
  let health = null;
  if (senders.length >= 2) {
    const ca = perSender[A]?.msgs || 0, cb = perSender[B]?.msgs || 0;
    const balance = Math.round((1 - Math.abs(ca - cb) / Math.max(1, ca + cb)) * 100);
    const consistency = Math.round(Math.min(1, dayKeys.length / spanDaysN) * 100);
    const supportN = senders.reduce((s, x) => s + (perSender[x]?.support || 0), 0);
    const support = Math.round(Math.min(1, supportN / (totalMsgs / 100)) * 100);
    const humor = Math.round(Math.min(1, (moodTotals.funny || 0) / (totalMsgs / 30)) * 100);
    const romance = Math.round(Math.min(1, (moodTotals.romantic || 0) / (totalMsgs / 30)) * 100);
    const communication = Math.round(Math.min(1, rate / 30) * 100);
    const overall = Math.round((balance + consistency + support + humor + romance + communication) / 6);
    health = {
      overall,
      parts: [
        ["💬 Communication", communication, `${rate.toFixed(0)} messages/day on average`],
        ["⚖️ Balance", balance, `${A} ${ca} vs ${B || ""} ${cb} messages`],
        ["📅 Consistency", consistency, `Active ${dayKeys.length} of ${Math.round(spanDaysN)} days`],
        ["🤗 Support", support, `${supportN} comforting messages`],
        ["😂 Humor", humor, `${moodTotals.funny || 0} funny moments`],
        ["❤️ Romance", romance, `${moodTotals.romantic || 0} romantic moments`],
      ],
    };
  }

  /* ---- favorite hours ---- */
  const bestHour = (arr) => { let bi = 0; arr.forEach((v, i) => { if (v > arr[bi]) bi = i; }); return { hour: bi, n: arr[bi] }; };
  const favoriteHours = {
    active: bestHour(hourStats.active),
    romantic: bestHour(hourStats.romantic),
    funny: bestHour(hourStats.funny),
    happy: bestHour(hourStats.happy),
  };

  /* ---- calendar (github style) ---- */
  const calendar = {};
  for (const [ds, v] of Object.entries(dayCounts)) {
    const p = dateParts(ds);
    if (!p) continue;
    (calendar[p.yr] = calendar[p.yr] || []).push({ date: ds, ts: v.ts, count: v.count, firstIdx: v.firstIdx });
  }
  Object.values(calendar).forEach((arr) => arr.sort((a, b) => a.ts - b.ts));

  /* ---- hidden patterns ---- */
  const patterns = [
    ["👋 Most common greeting", top(greet, 1)[0]],
    ["🌙 Most common goodbye", top(bye, 1)[0]],
    ['💘 Most common reply to "I love you"', top(afterIly, 1)[0]],
    ["❓ Most asked question", top(questions, 1)[0]],
    ["🌃 Most common late-night message", top(lateNight, 1)[0]],
    ["☀️ Most common first message of the day", top(firstMsgOfDay, 1)[0]],
  ].filter((x) => x[1]);

  /* ---- day extremes (for memories / this-day) ---- */
  const dayList = Object.entries(dayCounts).map(([date, v]) => ({ date, ...v }));
  const extremes = {
    mostActive: [...dayList].sort((a, b) => b.count - a.count)[0],
    mostRomantic: [...dayList].sort((a, b) => b.romantic - a.romantic)[0],
    funniest: [...dayList].sort((a, b) => b.funny - a.funny)[0],
    mostEmoji: [...dayList].sort((a, b) => b.emojis - a.emojis)[0],
    mostMedia: [...dayList].sort((a, b) => b.media - a.media)[0],
  };

  const nicknames = Object.entries(nickFirst)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => a.index - b.index);

  return {
    real, totalMsgs, mediaTotal, perSender,
    months, chapters, milestones, sessions, marathon, silences, fastest,
    topics, byYearTopic, byYearEmoji, energy, loveLang, comfort,
    awards, achievements, personalities, complexity, predictions, health,
    favoriteHours, calendar, patterns, extremes, dayCounts, dayList, nicknames,
    moodTotals,
  };
}

/* ================= memories (surprise me) ================= */

export function buildMemoryPool(ins, messages) {
  const pool = [];
  const push = (title, detail, index, date) => index != null && pool.push({ title, detail, index, date });
  const e = ins.extremes;
  if (e.mostActive) push("🔥 Your most active day", `${e.mostActive.count} messages`, e.mostActive.firstIdx, e.mostActive.date);
  if (e.mostRomantic?.romantic) push("😍 Your most romantic day", `${e.mostRomantic.romantic} romantic moments`, e.mostRomantic.firstIdx, e.mostRomantic.date);
  if (e.funniest?.funny) push("😂 Your funniest day", `${e.funniest.funny} laughs`, e.funniest.firstIdx, e.funniest.date);
  if (e.mostEmoji?.emojis) push("😀 Highest emoji day", `${e.mostEmoji.emojis} emojis`, e.mostEmoji.firstIdx, e.mostEmoji.date);
  if (e.mostMedia?.media) push("📸 Biggest photo day", `${e.mostMedia.media} media shared`, e.mostMedia.firstIdx, e.mostMedia.date);
  if (ins.marathon) push("🏃 Longest conversation", `${ins.marathon.count} messages over ${formatDuration(ins.marathon.endTs - ins.marathon.startTs)}`, ins.marathon.startIdx, ins.marathon.date);
  // one year ago (closest day)
  const target = Date.now() - 365 * DAY;
  const closest = ins.dayList.reduce((best, d) => (!best || Math.abs(d.ts - target) < Math.abs(best.ts - target) ? d : best), null);
  if (closest && Math.abs(closest.ts - target) < 20 * DAY) push("🕰 Around one year ago", `${closest.count} messages that day`, closest.firstIdx, closest.date);
  // random conversation starts
  for (const s of ins.sessions.filter((x) => x.count >= 15).slice(0, 60)) {
    push("🎲 A random conversation", `${s.count} messages`, s.startIdx, s.date);
  }
  ins.milestones.forEach((m) => push(m.label, m.preview, m.index, m.date));
  return pool;
}

/* ================= this day in history ================= */

export function thisDayInHistory(ins) {
  const now = new Date();
  const md = { m: now.getMonth() + 1, d: now.getDate() };
  const out = [];
  for (const day of ins.dayList) {
    const p = dateParts(day.date);
    if (p && p.mon === md.m && p.day === md.d) {
      out.push({
        year: p.yr, date: day.date, count: day.count, firstIdx: day.firstIdx,
        note: day.romantic > 3 ? "❤️ a very romantic day" : day.funny > 3 ? "😂 lots of laughs" : day.media > 3 ? "📸 photo sharing day" : null,
      });
    }
  }
  return out.sort((a, b) => a.year - b.year);
}

/* ================= rule-based summary (markdown) ================= */

export function buildSummaryMarkdown(chatName, stats, ins) {
  const lines = [`# 💬 ${chatName} — Chat Summary`, ""];
  lines.push(`**${ins.totalMsgs.toLocaleString()} messages** across **${Object.keys(ins.dayCounts).length} active days** (${formatDate(stats.first)} → ${formatDate(stats.last)}).`, "");
  if (ins.chapters.length > 1) {
    lines.push("## 📖 Chapters");
    ins.chapters.forEach((c) => lines.push(`- **${c.title}** — ${formatDate(c.startDate)} → ${formatDate(c.endDate)} · ${c.count.toLocaleString()} messages · top words: ${c.topWords.join(", ") || "—"}`));
    lines.push("");
  }
  if (ins.milestones.length) {
    lines.push("## 🏆 Milestones");
    ins.milestones.forEach((m) => lines.push(`- ${m.label} — ${formatDate(m.date)} (${m.sender}): "${m.preview}"`));
    lines.push("");
  }
  const funniest = [...ins.months].sort((a, b) => (b.moods.funny || 0) - (a.moods.funny || 0))[0];
  const emotional = [...ins.months].sort((a, b) => (b.moods.sad || 0) + (b.moods.worried || 0) - (a.moods.sad || 0) - (a.moods.worried || 0))[0];
  const active = [...ins.months].sort((a, b) => b.count - a.count)[0];
  lines.push("## ✨ Highlights");
  if (active) lines.push(`- Most active month: **${active.label}** (${active.count.toLocaleString()} messages)`);
  if (funniest?.moods.funny) lines.push(`- Funniest month: **${funniest.label}** (${funniest.moods.funny} laughs)`);
  if (emotional && (emotional.moods.sad || emotional.moods.worried)) lines.push(`- Most emotional month: **${emotional.label}**`);
  if (ins.silences[0]) lines.push(`- Longest silence: **${formatDuration(ins.silences[0].ms)}** (${formatDate(ins.silences[0].beforeDate)} → ${formatDate(ins.silences[0].afterDate)})`);
  if (ins.marathon) lines.push(`- Longest conversation: **${ins.marathon.count} messages** on ${formatDate(ins.marathon.date)}`);
  lines.push("");
  if (ins.patterns.length) {
    lines.push("## 🔍 Patterns");
    ins.patterns.forEach(([label, [text, n]]) => lines.push(`- ${label}: "${text}" (${n}×)`));
    lines.push("");
  }
  if (ins.health) {
    lines.push(`## ❤️ Conversation health: ${ins.health.overall}/100`);
    ins.health.parts.forEach(([l, v, why]) => lines.push(`- ${l}: **${v}/100** — ${why}`));
  }
  return lines.join("\n");
}
