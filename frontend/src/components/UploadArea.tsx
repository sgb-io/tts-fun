"use client";

import React, { useCallback, useRef, useState } from "react";
import styles from "./UploadArea.module.css";

const MAX_CLIP_SECONDS = 30;

function fmtDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function getAudioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.addEventListener("loadedmetadata", () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    });
    audio.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      resolve(null);
    });
    audio.src = url;
  });
}

interface Props {
  file: File | null;
  onChange: (file: File | null) => void;
}

export function UploadArea({ file, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState("");
  const [warn, setWarn] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback(
    async (f: File | null) => {
      if (!f) {
        onChange(null);
        setLabel("");
        setWarn(false);
        return;
      }
      onChange(f);
      const dur = await getAudioDuration(f);
      if (dur !== null) {
        const lbl = fmtDuration(dur);
        if (dur > MAX_CLIP_SECONDS) {
          setLabel(`${f.name} — ⚠️ ${lbl} (max ${MAX_CLIP_SECONDS}s)`);
          setWarn(true);
        } else {
          setLabel(`${f.name} — ${lbl}`);
          setWarn(false);
        }
      } else {
        setLabel(f.name);
        setWarn(false);
      }
    },
    [onChange],
  );

  return (
    <div
      className={`${styles.area} ${dragging ? styles.dragOver : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) handleFile(f);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        className={styles.input}
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
      />
      <div className={styles.icon}>🎤</div>
      <div className={styles.prompt}>
        Click or drag &amp; drop an audio file here
      </div>
      {label && (
        <div
          className={styles.filename}
          style={{ color: warn ? "var(--danger)" : undefined }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

export { MAX_CLIP_SECONDS, getAudioDuration, fmtDuration };
