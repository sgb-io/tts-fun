"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/ToastProvider";
import { deleteEpisode, getLlmStatus, listEpisodes } from "@/lib/api";
import type { EpisodeSummary } from "@/lib/types";
import styles from "./podcast.module.css";

export function EpisodeListPage() {
  const { toast } = useToast();
  const [episodes, setEpisodes] = useState<EpisodeSummary[] | null>(null);
  const [llmOnline, setLlmOnline] = useState<boolean | null>(null);

  const loadEpisodes = useCallback(async () => {
    try {
      const d = await listEpisodes();
      setEpisodes(d.episodes ?? []);
    } catch {
      setEpisodes([]);
    }
  }, []);

  useEffect(() => {
    loadEpisodes();
    getLlmStatus()
      .then((d) => setLlmOnline(d.online))
      .catch(() => setLlmOnline(false));
  }, [loadEpisodes]);

  async function handleDelete(id: string, title: string) {
    if (!confirm(`Delete episode "${title}" and all its audio files?`)) return;
    try {
      await deleteEpisode(id);
      setEpisodes((prev) => (prev ?? []).filter((e) => e.id !== id));
      toast("Episode deleted.", "success");
    } catch (e: unknown) {
      toast(`Error: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  const phaseLabels: Record<number, string> = {
    1: "✍️ Script",
    2: "🔊 Audio",
    3: "✅ Done",
  };

  return (
    <div className="card">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <h2>🎙 Podcast Episodes</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span
            className={`status-dot${llmOnline === true ? " online" : llmOnline === false ? " offline" : ""}`}
            title="LLM status"
          />
          <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
            {llmOnline === null
              ? "checking LLM…"
              : llmOnline
                ? "LLM online"
                : "LLM offline"}
          </span>
          <Link href="/podcast/new" className="btn btn-primary btn-sm">
            ＋ New Episode
          </Link>
        </div>
      </div>

      <div className="ref-list">
        {episodes === null && <p className="ref-empty">Loading episodes…</p>}
        {episodes !== null && episodes.length === 0 && (
          <p className="ref-empty">
            No episodes yet. Click <em>＋ New Episode</em> to get started.
          </p>
        )}
        {(episodes ?? []).map((ep) => {
          const speakerNames = (ep.speakers ?? [])
            .map((s) => s.name)
            .join(", ");
          return (
            <div key={ep.id} className={styles.episodeItem}>
              <div className={styles.epInfo}>
                <div className={styles.epTitle}>{ep.title}</div>
                <div className={styles.epMeta}>
                  <span className={`phase-badge phase-${ep.phase}`}>
                    {phaseLabels[ep.phase] ?? ""}
                  </span>
                  &nbsp;{ep.length_minutes}min · {(ep.speakers ?? []).length}{" "}
                  speakers ({speakerNames}) &nbsp;· {ep.turn_count} turn
                  {ep.turn_count !== 1 ? "s" : ""}
                </div>
              </div>
              <Link href={`/podcast/${ep.id}`} className="btn btn-ghost btn-sm">
                Open
              </Link>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => handleDelete(ep.id, ep.title)}
              >
                🗑
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
