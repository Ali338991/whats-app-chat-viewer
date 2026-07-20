import "./globals.css";

export const metadata = {
  title: "WhatsApp Chat Viewer",
  description: "View exported WhatsApp .txt chats in a WhatsApp-style UI — private, everything stays in your browser.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
