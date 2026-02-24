"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import {
  finalizeEpisode,
  generateClip,
  getEpisode,
  updateEpisode,
} from "@/lib/api";
import type { Episode, ScriptTurn } from "@/lib/types";

const SPEAKER_COLORS = ["speaker-0", "speaker-1", "speaker-2", "speaker-3"];

interface Props {
  episode: Episode;
  onEpisodeUpdate: (ep: Episode) => void;
  onBack: () => void;
  onFinalize: (ep: Episode) => void;
}

export function Phase2Audio({
  episode,
  onEpisodeUpdate,
  onBack,
  onFinalize,
}: Props) {
  const { toast } = useToast();
  const [ep, setEp] = useState<Episode>(episode);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [busyTurns, setBusyTurns] = useState<Set<number>>(new Set());
  const [finalizing, setFinalizing] = useState(false);
  // Editable text for each turn (detached from episode state so user can freely type)
  const [turnTexts, setTurnTexts] = useState<string[]>(
    (episode.script ?? []).map((t) => t.text),
  );
  // Audio cache-bust keys per turn
  const [audioKeys, setAudioKeys] = useState<Record<number, number>>({});

  useEffect(() => {
    setEp(episode);
    setTurnTexts((episode.script ?? []).map((t) => t.text));
  }, [episode]);

  const script = ep.script ?? [];

  const totalClips = script.length;
  const doneClips = script.filter((t) => t.audio_path).length;
  const pct = totalClips ? Math.round((doneClips / totalClips) * 100) : 0;
  const allDone = doneClips === totalClips && totalClips > 0;

  function setTurnBusy(i: number, busy: boolean) {
    setBusyTurns((prev) => {
      const next = new Set(prev);
      busy ? next.add(i) : next.delete(i);
      return next;
    });
  }

  async function doGenerateClip(i: number) {
    if (busyTurns.has(i)) return;
    const text = turnTexts[i]?.trim();
    if (!text) {
      toast("Turn text cannot be empty.", "error");
      return;
    }

    setTurnBusy(i, true);
    try {
      // Save any text edits for this turn first
      if (text !== (ep.script?.[i] ?? {}).text) {
        const newScript = (ep.script ?? []).map((t, idx) =>
          idx === i ? { ...t, text, audio_path: null } : t,
        );
        const saved = await updateEpisode(ep.id, { script: newScript });
        setEp(saved);
        onEpisodeUpdate(saved);
      }
      await generateClip(ep.id, i);
      // Refresh episode
      const refreshed = await getEpisode(ep.id);
      setEp(refreshed);
      onEpisodeUpdate(refreshed);
      setAudioKeys((prev) => ({ ...prev, [i]: Date.now() }));
      toast(`Clip ${i + 1} generated.`, "success");
    } catch (e: unknown) {
      toast(
        `Clip ${i + 1} failed: ${e instanceof Error ? e.message : String(e)}`,
        "error",
        6000,
      );
    } finally {
      setTurnBusy(i, false);
    }
  }

  async function generateAll() {
    setGeneratingAll(true);
    try {
      for (let i = 0; i < script.length; i++) {
        await doGenerateClip(i);
      }
      toast("All clips generated!", "success");
    } finally {
      setGeneratingAll(false);
    }
  }

  async function handleBack() {
    // Persist any text edits before going back
    try {
      const updatedScript = (ep.script ?? []).map((turn, i) => {
        const text = turnTexts[i]?.trim();
        if (text && text !== turn.text)
          return { ...turn, text, audio_path: null };
        return turn;
      });
      const saved = await updateEpisode(ep.id, {
        script: updatedScript,
        phase: 1,
      });
      onEpisodeUpdate(saved);
    } catch {
      // Ignore — just navigate back
    }
    onBack();
  }

  async function handleFinalize() {
    setFinalizing(true);
    try {
      const res = await finalizeEpisode(ep.id);
      onEpisodeUpdate(res.episode);
      onFinalize(res.episode);
      toast("Episode finalized!", "success");
    } catch (e: unknown) {
      toast(`Error: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <button className="btn btn-ghost btn-sm" onClick={handleBack}>
          ← Edit Script
        </button>
        <span style={{ fontWeight: 600, fontSize: "1rem", flex: 1 }}>
          {ep.title}
        </span>
        <button
          className={`btn btn-primary btn-sm${generatingAll ? " loading" : ""}`}
          disabled={generatingAll}
          onClick={generateAll}
        >
          ▶ Generate All Clips
        </button>
      </div>

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
          <h2>
            Audio Generation <small>Phase 2 of 3</small>
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "0.82rem", color: "var(--muted)" }}>
              {doneClips}/{totalClips} clips
            </span>
            <div className="progress-bar-wrap" style={{ width: 120 }}>
              <div className="progress-bar" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>

        <div className="turns-list">
          {script.map((turn, i) => {
            const cls = SPEAKER_COLORS[turn.speaker_index] ?? "speaker-0";
            const spkName =
              (ep.speakers ?? [])[turn.speaker_index]?.name ??
              `Speaker ${turn.speaker_index + 1}`;
            const busy = busyTurns.has(i);
            const hasAudio = !!turn.audio_path;
            const cacheKey = audioKeys[i] ?? 0;

            return (
              <div key={i} className="turn-item">
                <div className="turn-header">
                  <span className="turn-num">{i + 1}</span>
                  <span className={`speaker-badge ${cls}`}>{spkName}</span>
                </div>
                <textarea
                  rows={2}
                  style={{ resize: "vertical" }}
                  value={turnTexts[i] ?? turn.text}
                  onChange={(e) =>
                    setTurnTexts((prev) => {
                      const next = [...prev];
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                />
                <div className="clip-audio-row">
                  {hasAudio ? (
                    <audio
                      controls
                      src={`/api/podcast/episodes/${ep.id}/clips/${i}?t=${cacheKey}`}
                    />
                  ) : (
                    <span
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--muted)",
                        flex: 1,
                      }}
                    >
                      No audio yet
                    </span>
                  )}
                  <button
                    className={`btn btn-ghost btn-sm${busy ? " loading" : ""}`}
                    disabled={busy}
                    onClick={() => doGenerateClip(i)}
                  >
                    {hasAudio ? "↻ Regenerate" : "▶ Generate"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <button
          className={`btn btn-primary${finalizing ? " loading" : ""}`}
          style={{ alignSelf: "flex-end" }}
          disabled={!allDone || finalizing}
          onClick={handleFinalize}
        >
          🎧 Finalize Episode →
        </button>
      </div>
    </>
  );
}
