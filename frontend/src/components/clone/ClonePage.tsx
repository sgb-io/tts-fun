"use client";

import { useRef, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import {
  UploadArea,
  getAudioDuration,
  fmtDuration,
  MAX_CLIP_SECONDS,
} from "@/components/UploadArea";
import { addVoice, youtubeClone } from "@/lib/api";
import styles from "./ClonePage.module.css";

const YT_MSGS = [
  "Downloading audio from YouTube…",
  "Trimming to first 30 seconds…",
  "Extracting transcript from captions…",
  "Adding voice to library…",
];

export function ClonePage() {
  const { toast } = useToast();

  // YouTube clone state
  const [ytUrl, setYtUrl] = useState("");
  const [ytLoading, setYtLoading] = useState(false);
  const [ytMsgIdx, setYtMsgIdx] = useState(0);

  // Manual upload state
  const [voiceId, setVoiceId] = useState("");
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [transcript, setTranscript] = useState("");
  const [uploading, setUploading] = useState(false);

  // ── YouTube clone ──────────────────────────────────────────────────────────
  async function handleYtClone() {
    if (!ytUrl.trim()) {
      toast("Please enter a YouTube URL.", "error");
      return;
    }
    setYtLoading(true);
    setYtMsgIdx(0);
    const timer = setInterval(() => {
      setYtMsgIdx((i) => Math.min(i + 1, YT_MSGS.length - 1));
    }, 5000);
    try {
      const d = await youtubeClone(ytUrl.trim());
      if (d.success) {
        toast(
          `Voice "${d.id}" cloned and saved! You can now use it in Generate.`,
          "success",
          8000,
        );
        setYtUrl("");
      } else {
        toast(d.detail ?? d.message ?? "Clone failed.", "error", 9000);
      }
    } catch (e: unknown) {
      toast(
        `Request failed: ${e instanceof Error ? e.message : String(e)}`,
        "error",
        6000,
      );
    } finally {
      clearInterval(timer);
      setYtLoading(false);
    }
  }

  // ── Manual upload ──────────────────────────────────────────────────────────
  async function handleManualClone() {
    if (!voiceId.trim()) {
      toast("Please enter a Voice ID.", "error");
      return;
    }
    if (!cloneFile) {
      toast("Please upload a reference audio file.", "error");
      return;
    }
    if (!transcript.trim()) {
      toast("Please enter the transcript.", "error");
      return;
    }

    const dur = await getAudioDuration(cloneFile);
    if (dur !== null && dur > MAX_CLIP_SECONDS) {
      toast(
        `Clip is ${fmtDuration(dur)} — please trim it to ${MAX_CLIP_SECONDS}s or less. ` +
          "Longer clips exceed the model's context window and will crash.",
        "error",
        8000,
      );
      return;
    }
    if (!/^[a-zA-Z0-9\-_ ]+$/.test(voiceId.trim())) {
      toast(
        "Voice ID may only contain letters, numbers, hyphens, underscores, and spaces.",
        "error",
      );
      return;
    }

    setUploading(true);
    const fd = new FormData();
    fd.append("id", voiceId.trim());
    fd.append("text", transcript.trim());
    fd.append("audio", cloneFile);
    try {
      const d = await addVoice(fd);
      if (d.success) {
        toast(
          `Voice "${voiceId.trim()}" saved! You can now use it in Generate.`,
          "success",
        );
        setVoiceId("");
        setTranscript("");
        setCloneFile(null);
      } else {
        toast(d.message ?? "Failed.", "error", 6000);
      }
    } catch (e: unknown) {
      toast(
        `Request failed: ${e instanceof Error ? e.message : String(e)}`,
        "error",
        6000,
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      {/* YouTube clone overlay */}
      {ytLoading && (
        <div className={styles.overlay}>
          <div className={styles.spinner} />
          <div className={styles.overlayTitle}>Cloning voice from YouTube</div>
          <div className={styles.overlayStatus}>{YT_MSGS[ytMsgIdx]}</div>
          <div className={styles.overlayHint}>
            This may take up to a minute&hellip;
          </div>
        </div>
      )}

      {/* YouTube clone card */}
      <div className="card">
        <h2>🎬 Clone from YouTube</h2>
        <p className={styles.hint}>
          Paste a YouTube URL. The app will download the audio, trim it to the
          first 30 seconds, extract the auto-generated English captions, and
          save the result as a new voice — no manual steps needed.
        </p>
        <p className={styles.hintSmall}>
          ⓘ The video must have English auto-generated captions enabled.
        </p>
        <div>
          <label htmlFor="yt-url">YouTube URL</label>
          <input
            type="text"
            id="yt-url"
            value={ytUrl}
            onChange={(e) => setYtUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            autoComplete="off"
          />
        </div>
        <button
          className={`btn btn-primary${ytLoading ? " loading" : ""}`}
          disabled={ytLoading}
          onClick={handleYtClone}
        >
          <span>▶</span> Clone from YouTube
        </button>
      </div>

      <div className="or-divider">
        <span>or upload manually</span>
      </div>

      {/* Manual upload card */}
      <div className="card">
        <h2>Manual Upload</h2>
        <p className={styles.hint}>
          Upload a clean reference audio clip (10–30 seconds, WAV or MP3)
          together with an accurate transcript. The cloned voice will be saved
          and available in the <em>Generate</em> tab.
        </p>

        <div>
          <label htmlFor="clone-id">
            Voice ID <small>(letters, numbers, hyphens, spaces)</small>
          </label>
          <input
            type="text"
            id="clone-id"
            value={voiceId}
            onChange={(e) => setVoiceId(e.target.value)}
            placeholder="e.g. my-voice"
            maxLength={64}
          />
        </div>

        <div>
          <label>Reference audio</label>
          <UploadArea file={cloneFile} onChange={setCloneFile} />
        </div>

        <div>
          <label htmlFor="clone-text">
            Transcript <small>(what is spoken in the reference clip)</small>
          </label>
          <textarea
            id="clone-text"
            rows={3}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Paste the exact text spoken in the reference audio…"
          />
        </div>

        <button
          className={`btn btn-primary${uploading ? " loading" : ""}`}
          disabled={uploading}
          onClick={handleManualClone}
        >
          <span>＋</span> Save Voice
        </button>
      </div>
    </>
  );
}
