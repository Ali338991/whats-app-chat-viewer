import Link from "next/link";
import { BRAND_NAME, BRAND_TAGLINE } from "../../lib/brand";
import { IconLogo, IconLock, IconImage, IconShield, IconPhone } from "./Icons";

// Split layout for /login and /signup: gradient brand panel + form panel.
export default function AuthShell({ children }) {
  return (
    <div className="auth-page">
      <section className="auth-brand">
        <div className="auth-brand-inner">
          <Link href="/" className="brand brand-light"><IconLogo size={34} /><span>{BRAND_NAME}</span></Link>
          <div className="auth-pitch">
            <h1>{BRAND_TAGLINE}</h1>
            <p>Upload a WhatsApp export once, then relive it from any browser — every message, exactly as it was.</p>
          </div>
          <ul className="auth-props">
            <li><span className="ap-ic"><IconShield size={18} /></span><div><b>Private by design</b><small>Your chats live in your own vault, never shared or public.</small></div></li>
            <li><span className="ap-ic"><IconLock size={18} /></span><div><b>Password-protected</b><small>Signed sessions, lockout after repeated failed sign-ins.</small></div></li>
            <li><span className="ap-ic"><IconImage size={18} /></span><div><b>All your media</b><small>Photos, videos, voice notes and documents — kept forever.</small></div></li>
            <li><span className="ap-ic"><IconPhone size={18} /></span><div><b>Free up your phone</b><small>Delete the chat from your phone once it&apos;s safely stored.</small></div></li>
          </ul>
          <div className="auth-orb a" /><div className="auth-orb b" />
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">{children}</div>
      </section>
    </div>
  );
}
