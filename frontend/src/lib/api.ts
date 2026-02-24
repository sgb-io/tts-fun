/**
 * Thin API helpers.
 * All paths are relative (/api/…) — Next.js rewrites them to the FastAPI backend.
 */

import type { Episode, EpisodeSummary, Speaker, ScriptTurn } from "./types";

// ── Shared fetch helper ────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(text);
  }
  return res.json() as Promise<T>;
}

// ── Status ─────────────────────────────────────────────────────────────────

export async function getApiStatus(): Promise<{ online: boolean }> {
  return apiFetch("/api/status");
}

export async function getLlmStatus(): Promise<{ online: boolean }> {
  return apiFetch("/api/llm/status");
}

// ── References (voice library) ─────────────────────────────────────────────

export async function listVoices(): Promise<{ reference_ids: string[] }> {
  return apiFetch("/api/references/list");
}

export async function deleteVoice(id: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/references/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function addVoice(
  formData: FormData,
): Promise<{ success: boolean; message?: string }> {
  const res = await fetch("/api/references/add", {
    method: "POST",
    body: formData,
  });
  const d = await res.json().catch(() => ({ success: false }));
  if (!res.ok && res.status !== 200)
    throw new Error(d.message ?? `HTTP ${res.status}`);
  return d;
}

export async function youtubeClone(
  url: string,
): Promise<{
  success: boolean;
  id?: string;
  detail?: string;
  message?: string;
}> {
  return apiFetch("/api/youtube-clone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

// ── TTS ────────────────────────────────────────────────────────────────────

export async function generateTts(formData: FormData): Promise<Blob> {
  const res = await fetch("/api/tts", { method: "POST", body: formData });
  if (!res.ok)
    throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
  return res.blob();
}

// ── Podcast episodes ───────────────────────────────────────────────────────

export async function listEpisodes(): Promise<{ episodes: EpisodeSummary[] }> {
  return apiFetch("/api/podcast/episodes");
}

export async function getEpisode(id: string): Promise<Episode> {
  return apiFetch(`/api/podcast/episodes/${id}`);
}

export async function createEpisode(body: {
  title: string;
  speakers: Speaker[];
  prompt: string;
  length_minutes: number;
}): Promise<Episode> {
  return apiFetch("/api/podcast/episodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function updateEpisode(
  id: string,
  body: {
    title?: string;
    speakers?: Speaker[];
    prompt?: string;
    length_minutes?: number;
    script?: ScriptTurn[];
    phase?: number;
  },
): Promise<Episode> {
  return apiFetch(`/api/podcast/episodes/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function deleteEpisode(id: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/podcast/episodes/${id}`, { method: "DELETE" });
}

export async function generateScript(id: string): Promise<Episode> {
  return apiFetch(`/api/podcast/episodes/${id}/generate-script`, {
    method: "POST",
  });
}

export async function generateClip(
  episodeId: string,
  turnIndex: number,
): Promise<unknown> {
  return apiFetch(`/api/podcast/episodes/${episodeId}/clips/${turnIndex}`, {
    method: "POST",
  });
}

export async function finalizeEpisode(
  id: string,
): Promise<{ episode: Episode }> {
  return apiFetch(`/api/podcast/episodes/${id}/finalize`, { method: "POST" });
}
