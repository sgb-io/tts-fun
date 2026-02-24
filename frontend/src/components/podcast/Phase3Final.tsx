"use client";

import { useToast } from "@/components/ToastProvider";
import { updateEpisode } from "@/lib/api";
import type { Episode } from "@/lib/types";
import styles from "./podcast.module.css";

interface Props {
  episode: Episode;
  onEpisodeUpdate: (ep: Episode) => void;
  onBackToAudio: () => void;
  onBackToList: () => void;
}

export function Phase3Final({
  episode,
  onEpisodeUpdate,
  onBackToAudio,
  onBackToList,
}: Props) {
  const { toast } = useToast();

  const safeName = episode.title.replace(/[^\w\s-]/g, "").trim();
  const audioSrc = `/api/podcast/episodes/${episode.id}/final?t=${Date.now()}`;

  async function handleBackToAudio() {
    try {
      const ep = await updateEpisode(episode.id, { phase: 2 });
      onEpisodeUpdate(ep);
    } catch {
      // Ignore — just navigate
    }
    onBackToAudio();
  }

  return (
    <>
      <div className={styles.phaseNav}>
        <button className="btn btn-ghost btn-sm" onClick={handleBackToAudio}>
          ← Edit Audio
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onBackToList}>
          ⟵ All Episodes
        </button>
        <span className={styles.phaseTitle}>{episode.title}</span>
      </div>

      <div className="card">
        <h2>
          ✅ Episode Complete <small>Phase 3 of 3</small>
        </h2>

        <div className="audio-section">
          <audio controls src={audioSrc} style={{ width: "100%" }} />
          <div className="audio-actions">
            <a
              className="btn btn-primary"
              href={`/api/podcast/episodes/${episode.id}/final`}
              download={`${safeName}.wav`}
            >
              ⬇ Download WAV
            </a>
            <a
              className="btn btn-ghost"
              href={`/api/podcast/episodes/${episode.id}/transcript`}
              download={`${safeName}-transcript.txt`}
            >
              📄 Download Transcript
            </a>
          </div>
        </div>

        {episode.transcript && (
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 14,
              fontSize: "0.82rem",
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
              maxHeight: 300,
              overflowY: "auto",
            }}
          >
            {episode.transcript}
          </div>
        )}
      </div>
    </>
  );
}
