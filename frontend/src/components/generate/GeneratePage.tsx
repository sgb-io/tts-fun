"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { generateTts, listVoices } from "@/lib/api";
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

  async function doGenerate() {
    const text = textRef.current?.value.trim();
    if (!text) {
      toast("Please enter some text.", "error");
      return;
    }

    setLoading(true);
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

    try {
      const blob = await generateTts(fd);
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

        <button
          className={`btn btn-primary${loading ? " loading" : ""}`}
          disabled={loading}
          onClick={doGenerate}
        >
          <span>▶</span> Generate
        </button>
      </div>

      {audioUrl && (
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
    </>
  );
}
