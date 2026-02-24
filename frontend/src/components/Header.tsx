"use client";

import { useEffect, useState } from "react";
import styles from "./Header.module.css";
import { getApiStatus } from "@/lib/api";

type Status = "checking" | "online" | "offline";

export function Header() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    const check = async () => {
      try {
        const d = await getApiStatus();
        setStatus(d.online ? "online" : "offline");
      } catch {
        setStatus("offline");
      }
    };
    check();
    const id = setInterval(check, 15_000);
    return () => clearInterval(id);
  }, []);

  const statusLabel =
    status === "checking"
      ? "checking API…"
      : status === "online"
        ? "API online"
        : "API offline";

  return (
    <header className={styles.header}>
      <span className={styles.logo}>🎙️</span>
      <h1 className={styles.title}>TTS Fun</h1>
      <span
        className={`status-dot ${status !== "checking" ? status : ""}`}
        title="API status"
      />
      <span className={styles.sub}>{statusLabel}</span>
    </header>
  );
}
