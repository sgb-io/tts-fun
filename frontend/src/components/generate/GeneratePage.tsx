"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { generateTts, listVoices, chunkText } from "@/lib/api";
import styles from "./GeneratePage.module.css";

export function GeneratePage() {
  const { toast } = useToast();

  const [voices, setVoices] = useState<string[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [fmt, setFmt] = useState("wav");
  const [loading, setLoading] = useState(false);

  // Advanced params
  const [temp, setTemp] = useState(0.8);
  const [topP, setTopP] = useState(0.8);
  const [rep, setRep] = useState(1.1);
  const [chunk, setChunk] = useState(200);
  const [seed, setSeed] = useState("");
  const [normalize, setNormalize] = useState(true);

  // Auto-chunking state
  const [autoChunkEnabled, setAutoChunkEnabled] = useState(false);
  const [chunking, setChunking] = useState(false);
  const [chunks, setChunks] = useState<string[]>([]);
  const [chunkAudios, setChunkAudios] = useState<(string | null)[]>([]);
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);
  const [generatingAll, setGeneratingAll] = useState(false);

  const textRef = useRef<HTMLTextAreaElement>(null);
  const voiceRef = useRef<HTMLSelectElement>(null);
  const formatRef = useRef<HTMLSelectElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const downloadRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    listVoices()
      .then((d) => setVoices(d.reference_ids ?? []))
      .catch(() => {});
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function buildFormData(text: string): FormData {
    const fd = new FormData();
    fd.append("text", text);
    fd.append("format", fmt);
    fd.append("temperature", String(temp));
    fd.append("top_p", String(topP));
    fd.append("repetition_penalty", String(rep));
    fd.append("chunk_length", String(chunk));
    fd.append("normalize", String(normalize));
    const voiceId = voiceRef.current?.value;
    if (voiceId) fd.append("reference_id", voiceId);
    if (seed) fd.append("seed", seed);
    return fd;
  }

  // ── Single-clip generation ─────────────────────────────────────────────────

  async function doGenerate() {
    const text = textRef.current?.value.trim();
    if (!text) {
      toast("Please enter some text.", "error");
      return;
    }

    setLoading(true);
    try {
      const blob = await generateTts(buildFormData(text));
      const url = URL.createObjectURL(blob);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(url);
      if (downloadRef.current) {
        downloadRef.current.href = url;
        downloadRef.current.download = `output.${fmt}`;
      }
      setTimeout(() => audioRef.current?.play().catch(() => {}), 50);
      toast("Audio generated!", "success");
    } catch (e: unknown) {
      toast(
        `Error: ${e instanceof Error ? e.message : String(e)}`,
        "error",
        6000,
      );
    } finally {
      setLoading(false);
    }
  }

  // ── Auto-chunking ──────────────────────────────────────────────────────────

  async function doChunk() {
    const text = textRef.current?.value.trim();
    if (!text) {
      toast("Please enter some text to chunk.", "error");
      return;
    }
    setChunking(true);
    setChunks([]);
    setChunkAudios([]);
    try {
      const result = await chunkText(text);
      setChunks(result.chunks);
      setChunkAudios(new Array(result.chunks.length).fill(null));
      toast(`Split into ${result.chunks.length} chunks.`, "success");
    } catch (e: unknown) {
      toast(
        `Chunking error: ${e instanceof Error ? e.message : String(e)}`,
        "error",
        6000,
      );
    } finally {
      setChunking(false);
    }
  }

  async function generateOneChunk(
    text: string,
    idx: number,
  ): Promise<string | null> {
    if (!text.trim()) return null;
    try {
      const blob = await generateTts(buildFormData(text));
      return URL.createObjectURL(blob);
    } catch (e: unknown) {
      toast(
        `Chunk ${idx + 1} error: ${e instanceof Error ? e.message : String(e)}`,
        "error",
        6000,
      );
      return null;
    }
  }

  async function doGenerateOne(idx: number) {
    setGeneratingIdx(idx);
    const url = await generateOneChunk(chunks[idx], idx);
    if (url !== null) {
      setChunkAudios((prev) => {
        const next = [...prev];
        if (next[idx]) URL.revokeObjectURL(next[idx]!);
        next[idx] = url;
        return next;
      });
    }
    setGeneratingIdx(null);
  }

  async function doGenerateAll() {
    setGeneratingAll(true);
    const snapshot = [...chunks];
    for (let i = 0; i < snapshot.length; i++) {
      setGeneratingIdx(i);
      const url = await generateOneChunk(snapshot[i], i);
      if (url !== null) {
        setChunkAudios((prev) => {
          const next = [...prev];
          if (next[i]) URL.revokeObjectURL(next[i]!);
          next[i] = url;
          return next;
        });
      }
    }
    setGeneratingIdx(null);
    setGeneratingAll(false);
    toast("All chunks generated!", "success");
  }

  function updateChunk(idx: number, value: string) {
    setChunks((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }

  const isBusy = loading || chunking || generatingAll || generatingIdx !== null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="card">
        <h2>
          Text to Speech <small>FishAudio-S1-mini</small>
        </h2>

        <div>
          <label htmlFor="tts-text">Text</label>
          <textarea
            id="tts-text"
            ref={textRef}
            defaultValue="(excited) Welcome to TTS Fun! This is powered by FishAudio S1-mini — an open-source, high-quality text-to-speech model."
            placeholder="Enter the text you want to synthesise…"
          />
        </div>

        {/* Auto-chunk toggle */}
        <div className={styles.checkRow}>
          <input
            type="checkbox"
            id="tts-auto-chunk"
            checked={autoChunkEnabled}
            onChange={(e) => {
              setAutoChunkEnabled(e.target.checked);
              if (!e.target.checked) {
                setChunks([]);
                setChunkAudios([]);
              }
            }}
          />
          <label
            htmlFor="tts-auto-chunk"
            style={{ marginBottom: 0, cursor: "pointer" }}
          >
            Enable auto-chunking input
          </label>
        </div>

        <div className="form-row">
          <div>
            <label htmlFor="tts-voice">
              Reference voice <small>(optional)</small>
            </label>
            <select id="tts-voice" ref={voiceRef}>
              <option value="">— random voice —</option>
              {voices.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="tts-format">Output format</label>
            <select
              id="tts-format"
              ref={formatRef}
              value={fmt}
              onChange={(e) => setFmt(e.target.value)}
            >
              <option value="wav">WAV</option>
              <option value="mp3">MP3</option>
            </select>
          </div>
        </div>

        <details>
          <summary className={styles.advSummary}>
            ⚙️ Advanced parameters
          </summary>
          <div className={styles.advBody}>
            <div>
              <label>
                Temperature{" "}
                <span className="slider-val">{temp.toFixed(2)}</span>
              </label>
              <div className="slider-wrap">
                <input
                  type="range"
                  min={0.1}
                  max={1.0}
                  step={0.05}
                  value={temp}
                  onChange={(e) => setTemp(parseFloat(e.target.value))}
                />
              </div>
            </div>

            <div>
              <label>
                Top-P <span className="slider-val">{topP.toFixed(2)}</span>
              </label>
              <div className="slider-wrap">
                <input
                  type="range"
                  min={0.1}
                  max={1.0}
                  step={0.05}
                  value={topP}
                  onChange={(e) => setTopP(parseFloat(e.target.value))}
                />
              </div>
            </div>

            <div>
              <label>
                Repetition penalty{" "}
                <span className="slider-val">{rep.toFixed(2)}</span>
              </label>
              <div className="slider-wrap">
                <input
                  type="range"
                  min={0.9}
                  max={2.0}
                  step={0.05}
                  value={rep}
                  onChange={(e) => setRep(parseFloat(e.target.value))}
                />
              </div>
            </div>

            <div>
              <label>Chunk length (tokens)</label>
              <input
                type="number"
                value={chunk}
                min={100}
                max={300}
                step={10}
                onChange={(e) => setChunk(parseInt(e.target.value, 10))}
              />
            </div>

            <div>
              <label>
                Seed <small>(leave blank for random)</small>
              </label>
              <input
                type="number"
                value={seed}
                placeholder="e.g. 42"
                onChange={(e) => setSeed(e.target.value)}
              />
            </div>

            <div className={styles.checkRow}>
              <input
                type="checkbox"
                id="tts-normalize"
                checked={normalize}
                onChange={(e) => setNormalize(e.target.checked)}
              />
              <label
                htmlFor="tts-normalize"
                style={{ marginBottom: 0, cursor: "pointer" }}
              >
                Normalise text (numbers, dates)
              </label>
            </div>
          </div>
        </details>

        {autoChunkEnabled ? (
          <button
            className={`btn btn-primary${chunking ? " loading" : ""}`}
            disabled={isBusy}
            onClick={doChunk}
          >
            <span>✂</span> Chunk
          </button>
        ) : (
          <button
            className={`btn btn-primary${loading ? " loading" : ""}`}
            disabled={loading}
            onClick={doGenerate}
          >
            <span>▶</span> Generate
          </button>
        )}
      </div>

      {/* ── Single-clip output (non-chunked mode) ─────────────────────────── */}
      {!autoChunkEnabled && audioUrl && (
        <div className="card">
          <h2>Output</h2>
          <div className="audio-section">
            <audio ref={audioRef} controls src={audioUrl} />
            <div className="audio-actions">
              <a
                ref={downloadRef}
                className="btn btn-ghost"
                href={audioUrl}
                download={`output.${fmt}`}
              >
                ⬇ Download
              </a>
              <button
                className="btn btn-ghost"
                onClick={doGenerate}
                disabled={loading}
              >
                ↻ Re-generate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Chunk review + Generate All ───────────────────────────────────── */}
      {autoChunkEnabled && chunks.length > 0 && (
        <div className="card">
          <div className={styles.chunkCardHeader}>
            <h2>
              Chunks{" "}
              <small>
                {chunks.length} segment{chunks.length !== 1 ? "s" : ""}
              </small>
            </h2>
            <button
              className={`btn btn-primary${generatingAll ? " loading" : ""}`}
              disabled={isBusy}
              onClick={doGenerateAll}
            >
              <span>▶▶</span> Generate All
            </button>
          </div>

          <p className={styles.chunkHint}>
            Review and refine each chunk, then press{" "}
            <strong>Generate All</strong> or generate individual clips below.
          </p>

          <div className={styles.chunkList}>
            {chunks.map((text, idx) => (
              <div key={idx} className={styles.chunkItem}>
                <div className={styles.chunkItemHeader}>
                  <span className={styles.chunkBadge}>{idx + 1}</span>
                  <button
                    className={`btn btn-ghost${generatingIdx === idx ? " loading" : ""}`}
                    disabled={isBusy}
                    onClick={() => doGenerateOne(idx)}
                    title="Generate this chunk"
                  >
                    {generatingIdx === idx ? "Generating…" : "▶ Generate"}
                  </button>
                </div>

                <textarea
                  className={styles.chunkTextarea}
                  value={text}
                  onChange={(e) => updateChunk(idx, e.target.value)}
                  rows={3}
                />

                {chunkAudios[idx] && (
                  <div className={styles.chunkAudio}>
                    <audio controls src={chunkAudios[idx]!} />
                    <a
                      className="btn btn-ghost"
                      href={chunkAudios[idx]!}
                      download={`chunk-${idx + 1}.${fmt}`}
                    >
                      ⬇ Download
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
