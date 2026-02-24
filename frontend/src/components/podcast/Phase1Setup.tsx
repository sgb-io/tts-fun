"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import {
  createEpisode,
  generateScript,
  listVoices,
  updateEpisode,
} from "@/lib/api";
import type { Episode, ScriptTurn, Speaker } from "@/lib/types";
import styles from "./podcast.module.css";

const SPEAKER_NUM_COLORS = [
  { bg: "rgba(108,99,255,0.2)", color: "#8b84ff" },
  { bg: "rgba(62,207,142,0.15)", color: "#3ecf8e" },
  { bg: "rgba(245,166,35,0.15)", color: "#f5a623" },
  { bg: "rgba(96,165,250,0.15)", color: "#60a5fa" },
];

const SPEAKER_COLORS = ["speaker-0", "speaker-1", "speaker-2", "speaker-3"];

interface SpeakerRow extends Speaker {
  _key: number;
}

let speakerKeyCounter = 0;

function makeSpeakerRow(s: Partial<Speaker> = {}): SpeakerRow {
  return {
    name: s.name ?? "",
    bio: s.bio ?? "",
    voice_id: s.voice_id ?? "",
    _key: ++speakerKeyCounter,
  };
}

interface Props {
  episode: Episode | null; // null = new episode
  onEpisodeUpdate: (ep: Episode) => void;
  onApprove: (ep: Episode) => void;
}

export function Phase1Setup({ episode, onEpisodeUpdate, onApprove }: Props) {
  const { toast } = useToast();

  const [title, setTitle] = useState(episode?.title ?? "");
  const [prompt, setPrompt] = useState(episode?.prompt ?? "");
  const [length, setLength] = useState(episode?.length_minutes ?? 5);
  const [speakers, setSpeakers] = useState<SpeakerRow[]>(
    episode?.speakers?.length
      ? episode.speakers.map(makeSpeakerRow)
      : [makeSpeakerRow()],
  );
  const [voices, setVoices] = useState<string[]>([]);
  const [script, setScript] = useState<ScriptTurn[]>(episode?.script ?? []);
  const scriptListRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    listVoices()
      .then((d) => setVoices(d.reference_ids ?? []))
      .catch(() => {});
  }, []);

  // Sync from episode prop when it changes (e.g. after regenerate)
  useEffect(() => {
    if (episode) {
      setTitle(episode.title);
      setPrompt(episode.prompt);
      setLength(episode.length_minutes);
      setSpeakers(episode.speakers.map(makeSpeakerRow));
      setScript(episode.script ?? []);
    }
  }, [episode]);

  // ── Gather form data ──────────────────────────────────────────────────────

  function collectSpeakers(): Speaker[] {
    return speakers.map((s) => ({
      name: s.name,
      bio: s.bio,
      voice_id: s.voice_id,
    }));
  }

  function validate(): boolean {
    if (!title.trim()) {
      toast("Please enter an episode title.", "error");
      return false;
    }
    if (!prompt.trim()) {
      toast("Please enter an episode prompt.", "error");
      return false;
    }
    if (!speakers.length) {
      toast("Add at least one speaker.", "error");
      return false;
    }
    if (speakers.some((s) => !s.name)) {
      toast("All speakers need a name.", "error");
      return false;
    }
    if (isNaN(length) || length < 1 || length > 60) {
      toast("Length must be 1–60 minutes.", "error");
      return false;
    }
    return true;
  }

  async function saveSetup(): Promise<Episode | null> {
    if (!validate()) return null;
    const body = {
      title: title.trim(),
      speakers: collectSpeakers(),
      prompt: prompt.trim(),
      length_minutes: length,
    };
    try {
      let ep: Episode;
      if (episode) {
        ep = await updateEpisode(episode.id, body);
      } else {
        ep = await createEpisode(body);
      }
      onEpisodeUpdate(ep);
      return ep;
    } catch (e: unknown) {
      toast(
        `Save failed: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
      return null;
    }
  }

  async function handleSave() {
    setSaving(true);
    const ep = await saveSetup();
    setSaving(false);
    if (ep) toast("Episode saved.", "success");
  }

  async function handleGenerateScript() {
    setGenerating(true);
    const ep = await saveSetup();
    if (!ep) {
      setGenerating(false);
      return;
    }
    toast(
      "Generating script with LLM… this may take 30–90 seconds.",
      "info",
      10000,
    );
    try {
      const updated = await generateScript(ep.id);
      onEpisodeUpdate(updated);
      setScriptAndReset(updated.script ?? []);
      toast(
        `Script generated — ${(updated.script ?? []).length} turns. Review and approve!`,
        "success",
        6000,
      );
    } catch (e: unknown) {
      toast(
        `LLM error: ${e instanceof Error ? e.message : String(e)}`,
        "error",
        8000,
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleApprove() {
    if (!episode) return;
    const filtered = script.filter((t) => t.text.trim());
    if (!filtered.length) {
      toast("Script is empty.", "error");
      return;
    }
    setApproving(true);
    try {
      const ep = await updateEpisode(episode.id, {
        script: filtered,
        phase: 2,
      });
      onEpisodeUpdate(ep);
      onApprove(ep);
    } catch (e: unknown) {
      toast(`Error: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setApproving(false);
    }
  }

  function setScriptAndReset(turns: ScriptTurn[]) {
    setScript(turns);
    // Always scroll the list back to the top so turn #1 is visible
    requestAnimationFrame(() => {
      if (scriptListRef.current) scriptListRef.current.scrollTop = 0;
    });
  }

  function updateTurnText(i: number, text: string) {
    setScript((prev) => prev.map((t, idx) => (idx === i ? { ...t, text } : t)));
  }

  function updateTurnSpeaker(i: number, speakerIndex: number) {
    setScript((prev) =>
      prev.map((t, idx) =>
        idx === i ? { ...t, speaker_index: speakerIndex } : t,
      ),
    );
  }

  function deleteTurn(i: number) {
    setScript((prev) => prev.filter((_, idx) => idx !== i));
  }

  function addTurn() {
    setScript((prev) => [
      ...prev,
      { speaker_index: 0, text: "", audio_path: null },
    ]);
  }

  // ── Speaker management ─────────────────────────────────────────────────────

  function addSpeaker() {
    if (speakers.length >= 4) {
      toast("Maximum 4 speakers.", "error");
      return;
    }
    setSpeakers((prev) => [...prev, makeSpeakerRow()]);
  }

  function removeSpeaker(key: number) {
    setSpeakers((prev) => prev.filter((s) => s._key !== key));
  }

  function updateSpeaker(key: number, field: keyof Speaker, value: string) {
    setSpeakers((prev) =>
      prev.map((s) => (s._key === key ? { ...s, [field]: value } : s)),
    );
  }

  return (
    <>
      {/* Setup card */}
      <div className="card">
        <h2>
          Episode Setup <small>Phase 1 of 3</small>
        </h2>

        <div>
          <label htmlFor="ep-title">Episode title</label>
          <input
            type="text"
            id="ep-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. The Future of AI"
            maxLength={120}
          />
        </div>

        <div>
          <label htmlFor="ep-prompt">
            Episode prompt <small>(topic, tangents, style)</small>
          </label>
          <textarea
            id="ep-prompt"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. A deep-dive into how large language models work…"
          />
        </div>

        <div className="form-row">
          <div>
            <label htmlFor="ep-length">Length (minutes)</label>
            <input
              type="number"
              id="ep-length"
              value={length}
              min={1}
              max={60}
              onChange={(e) => setLength(parseInt(e.target.value, 10))}
            />
          </div>
          <div>
            <label>
              Speakers <small>(1–4)</small>
            </label>
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 2 }}
              onClick={addSpeaker}
            >
              ＋ Add speaker
            </button>
          </div>
        </div>

        {/* Speaker rows */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {speakers.map((spk, i) => {
            const c = SPEAKER_NUM_COLORS[i] ?? SPEAKER_NUM_COLORS[0];
            return (
              <div key={spk._key} className={styles.speakerRow}>
                <div
                  className={styles.speakerNum}
                  style={{ background: c.bg, color: c.color }}
                >
                  {i + 1}
                </div>
                <div className={styles.speakerFields}>
                  <div className="form-row" style={{ gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 100 }}>
                      <label>Name</label>
                      <input
                        type="text"
                        className="sp-name"
                        placeholder="e.g. Alex"
                        maxLength={60}
                        value={spk.name}
                        onChange={(e) =>
                          updateSpeaker(spk._key, "name", e.target.value)
                        }
                      />
                    </div>
                    <div style={{ flex: 2, minWidth: 160 }}>
                      <label>Bio / role</label>
                      <input
                        type="text"
                        placeholder="e.g. AI researcher, curious and direct"
                        maxLength={200}
                        value={spk.bio}
                        onChange={(e) =>
                          updateSpeaker(spk._key, "bio", e.target.value)
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <label>
                      Voice <small>(from Voice Library)</small>
                    </label>
                    <select
                      value={spk.voice_id}
                      onChange={(e) =>
                        updateSpeaker(spk._key, "voice_id", e.target.value)
                      }
                    >
                      <option value="">
                        {voices.length
                          ? "— random voice —"
                          : "— no voices saved —"}
                      </option>
                      {voices.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  className="btn btn-danger btn-sm"
                  style={{ flexShrink: 0, alignSelf: "flex-start" }}
                  title="Remove speaker"
                  onClick={() => removeSpeaker(spk._key)}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className={`btn btn-ghost${saving ? " loading" : ""}`}
            disabled={saving}
            onClick={handleSave}
          >
            💾 Save
          </button>
          <button
            className={`btn btn-primary${generating ? " loading" : ""}`}
            disabled={generating}
            onClick={handleGenerateScript}
          >
            ✨ Generate Script
          </button>
        </div>
      </div>

      {/* Script editor card */}
      {script.length > 0 && (
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
              Script Editor <small>edit turns freely</small>
            </h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-ghost btn-sm" onClick={addTurn}>
                ＋ Add turn
              </button>
              <button
                className={`btn btn-ghost btn-sm${generating ? " loading" : ""}`}
                disabled={generating}
                onClick={handleGenerateScript}
              >
                ↻ Regenerate
              </button>
              <button
                className={`btn btn-primary${approving ? " loading" : ""}`}
                disabled={approving}
                onClick={handleApprove}
              >
                ✅ Approve Script →
              </button>
            </div>
          </div>

          <div className="turns-list" ref={scriptListRef}>
            {script.map((turn, i) => {
              const cls = SPEAKER_COLORS[turn.speaker_index] ?? "speaker-0";
              const spkName =
                speakers[turn.speaker_index]?.name ??
                `Speaker ${turn.speaker_index + 1}`;
              return (
                <div key={i} className="turn-item">
                  <div className="turn-header">
                    <span className="turn-num">{i + 1}</span>
                    <select
                      style={{
                        width: "auto",
                        padding: "3px 8px",
                        fontSize: "0.8rem",
                      }}
                      value={turn.speaker_index}
                      onChange={(e) =>
                        updateTurnSpeaker(i, parseInt(e.target.value, 10))
                      }
                    >
                      {speakers.map((s, si) => (
                        <option key={si} value={si}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <span className={`speaker-badge ${cls}`}>{spkName}</span>
                    <button
                      className="btn btn-danger btn-sm"
                      style={{ marginLeft: "auto" }}
                      onClick={() => deleteTurn(i)}
                    >
                      ✕
                    </button>
                  </div>
                  <textarea
                    rows={3}
                    style={{ resize: "vertical" }}
                    value={turn.text}
                    onChange={(e) => updateTurnText(i, e.target.value)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
