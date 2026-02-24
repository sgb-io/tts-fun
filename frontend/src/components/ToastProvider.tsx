"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import type { ToastMessage, ToastType } from "@/lib/types";
import styles from "./Toast.module.css";

// ── Context ────────────────────────────────────────────────────────────────

interface ToastContextValue {
  toast: (msg: string, type?: ToastType, ms?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

// ── Provider ───────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const idRef = useRef(0);

  const toast = useCallback(
    (msg: string, type: ToastType = "info", ms = 4000) => {
      const id = ++idRef.current;
      setMessages((prev) => [...prev, { id, msg, type }]);
      setTimeout(() => {
        setMessages((prev) => prev.filter((m) => m.id !== id));
      }, ms);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className={styles.container}>
        {messages.map((m) => (
          <div key={m.id} className={`${styles.toast} ${styles[m.type]}`}>
            {m.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
