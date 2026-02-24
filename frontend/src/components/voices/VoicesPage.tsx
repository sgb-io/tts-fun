"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { deleteVoice, listVoices } from "@/lib/api";

export function VoicesPage() {
  const { toast } = useToast();
  const [voices, setVoices] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const d = await listVoices();
      setVoices(d.reference_ids ?? []);
    } catch {
      setErr("Failed to load voices.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(id: string) {
    if (!confirm(`Delete voice "${id}"?`)) return;
    try {
      const d = await deleteVoice(id);
      if (d.success) {
        setVoices((prev) => (prev ?? []).filter((v) => v !== id));
        toast(`Voice "${id}" deleted.`, "success");
      } else {
        toast("Delete failed.", "error");
      }
    } catch (e: unknown) {
      toast(`Error: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  }

  return (
    <div className="card">
      <h2>Saved Reference Voices</h2>
      <button
        className="btn btn-ghost"
        style={{ alignSelf: "flex-start" }}
        onClick={load}
      >
        ↻ Refresh
      </button>

      <div className="ref-list">
        {voices === null && !err && <p className="ref-empty">Loading…</p>}
        {err && <p className="ref-empty">{err}</p>}
        {voices !== null && voices.length === 0 && (
          <p className="ref-empty">
            No reference voices saved yet. Go to <em>Clone a Voice</em> to add
            one.
          </p>
        )}
        {(voices ?? []).map((id) => (
          <div key={id} className="ref-item">
            <span className="ref-id">🎙 {id}</span>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => handleDelete(id)}
            >
              🗑 Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
