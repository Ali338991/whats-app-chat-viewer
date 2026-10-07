"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import UploadPanel from "../components/UploadPanel";
import { BRAND_NAME } from "../../lib/brand";
import { IconLogo, IconShield, IconLock, IconImage, IconPhone, IconCheck, IconBack } from "../components/Icons";

const STEPS = ["Welcome", "Export", "Upload"];

const GUIDES = {
  iphone: [
    "Open the chat in WhatsApp.",
    "Tap the contact or group name at the top.",
    "Scroll down and tap Export Chat.",
    "Choose Attach Media.",
    "Pick Save to Files, then save the .zip somewhere you can find it.",
  ],
  android: [
    "Open the chat in WhatsApp.",
    "Tap ⋮ (the three dots) in the top-right corner.",
    "Tap More → Export chat.",
    "Choose Include media.",
    "Save the .zip (for example to Drive or Downloads).",
  ],
};

export default function Onboarding({ user }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState("iphone");
  const [uploading, setUploading] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const finish = useCallback(async (chatId) => {
    setLeaving(true);
    try { await fetch("/api/auth/onboarded", { method: "POST" }); } catch {}
    router.replace(chatId ? `/vault?chat=${encodeURIComponent(chatId)}` : "/vault");
    router.refresh();
  }, [router]);

  return (
    <div className="onb-page">
      <header className="onb-top">
        <div className="brand"><IconLogo size={30} /><span>{BRAND_NAME}</span></div>
        {!uploading && (
          <button className="btn btn-ghost btn-sm" onClick={() => finish(null)} disabled={leaving}>Skip for now</button>
        )}
      </header>

      <div className="onb-card">
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? "cur" : i < step ? "done" : ""}>
              <span className="step-dot">{i < step ? <IconCheck size={14} /> : i + 1}</span>
              <span className="step-name">{s}</span>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="onb-body">
            <h1>Welcome, {user.firstName} 👋</h1>
            <p className="onb-lead">Your vault keeps your WhatsApp chats safe — exactly as they were — so you can relive them anytime, from any browser.</p>
            <div className="onb-grid">
              <div className="onb-feat"><span className="of-ic"><IconShield size={20} /></span><b>Private</b><small>Never shared or made public.</small></div>
              <div className="onb-feat"><span className="of-ic"><IconLock size={20} /></span><b>Password-protected</b><small>Secure, signed sessions.</small></div>
              <div className="onb-feat"><span className="of-ic"><IconImage size={20} /></span><b>Kept forever</b><small>Photos, videos and voice notes included.</small></div>
              <div className="onb-feat"><span className="of-ic"><IconPhone size={20} /></span><b>Free up your phone</b><small>Delete the chat once it&apos;s stored.</small></div>
            </div>
            <div className="onb-actions">
              <span />
              <button className="btn btn-primary btn-lg" onClick={() => setStep(1)}>Get started</button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="onb-body">
            <h1>Export a chat from WhatsApp</h1>
            <p className="onb-lead">It takes about a minute. Make sure to include media so photos, videos and voice notes come along.</p>
            <div className="seg" role="tablist">
              <button role="tab" aria-selected={platform === "iphone"} className={platform === "iphone" ? "on" : ""} onClick={() => setPlatform("iphone")}>iPhone</button>
              <button role="tab" aria-selected={platform === "android"} className={platform === "android" ? "on" : ""} onClick={() => setPlatform("android")}>Android</button>
            </div>
            <ol className="guide">
              {GUIDES[platform].map((t, i) => (
                <li key={platform + i}><span className="g-num">{i + 1}</span><span>{t}</span></li>
              ))}
            </ol>
            <p className="onb-note">Then move the .zip to this computer — or simply open this page on the same phone.</p>
            <div className="onb-actions">
              <button className="btn btn-ghost" onClick={() => setStep(0)}><IconBack size={16} /> Back</button>
              <button className="btn btn-primary btn-lg" onClick={() => setStep(2)}>I have my export</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="onb-body">
            {!uploading && (
              <>
                <h1>Upload your first chat</h1>
                <p className="onb-lead">Drop the .zip below. Big exports are fine — files go straight to your private storage.</p>
              </>
            )}
            <UploadPanel title={null} onBusyChange={setUploading} onUploaded={(chat) => finish(chat?.id)} />
            {!uploading && (
              <div className="onb-actions">
                <button className="btn btn-ghost" onClick={() => setStep(1)}><IconBack size={16} /> Back</button>
                <button className="btn btn-ghost" onClick={() => finish(null)} disabled={leaving}>I&apos;ll do this later</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
