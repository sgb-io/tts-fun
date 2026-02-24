import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { NavTabs } from "@/components/NavTabs";
import { ToastProvider } from "@/components/ToastProvider";
import styles from "./layout.module.css";

export const metadata: Metadata = {
  title: "TTS Fun · FishAudio S1-mini",
  description: "Self-hosted text-to-speech powered by FishAudio S1-mini",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <Header />
          <main className={styles.main}>
            <NavTabs />
            {children}
          </main>
        </ToastProvider>
      </body>
    </html>
  );
}
