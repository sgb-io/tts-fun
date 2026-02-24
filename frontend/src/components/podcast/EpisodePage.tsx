"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/ToastProvider";
import { getEpisode } from "@/lib/api";
import type { Episode } from "@/lib/types";
import { Phase1Setup } from "./Phase1Setup";
import { Phase2Audio } from "./Phase2Audio";
import { Phase3Final } from "./Phase3Final";
import styles from "./podcast.module.css";

type View = "phase1" | "phase2" | "phase3";

interface Props {
  id: string; // 'new' or episode UUID slug
}

export function EpisodePage({ id }: Props) {
  const { toast } = useToast();
  const router = useRouter();

  const isNew = id === "new";
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [view, setView] = useState<View>("phase1");
  const [loading, setLoading] = useState(!isNew);

  useEffect(() => {
    if (isNew) return;
    getEpisode(id)
      .then((ep) => {
        setEpisode(ep);
        if (ep.phase === 3) setView("phase3");
        else if (ep.phase === 2) setView("phase2");
        else setView("phase1");
      })
      .catch(() => toast("Failed to load episode.", "error"))
      .finally(() => setLoading(false));
  }, [id, isNew, toast]);

  function handleEpisodeUpdate(ep: Episode) {
    setEpisode(ep);
    // Update router URL if we just created a new episode
    if (isNew) {
      router.replace(`/podcast/${ep.id}`);
    }
  }

  if (loading) {
    return (
      <p className="ref-empty" style={{ padding: 40 }}>
        Loading episode…
      </p>
    );
  }

  return (
    <>
      {/* Back to list (shown in phase 1 only; phase 2/3 have their own back buttons) */}
      {view === "phase1" && (
        <div className={styles.phaseNav} style={{ marginBottom: 8 }}>
          <Link href="/podcast" className="btn btn-ghost btn-sm">
            ← Episodes
          </Link>
          <span className={styles.phaseTitle}>
            {episode?.title ?? "New Episode"}
          </span>
        </div>
      )}

      {view === "phase1" && (
        <Phase1Setup
          episode={episode}
          onEpisodeUpdate={handleEpisodeUpdate}
          onApprove={(ep) => {
            setEpisode(ep);
            setView("phase2");
          }}
        />
      )}

      {view === "phase2" && episode && (
        <Phase2Audio
          episode={episode}
          onEpisodeUpdate={setEpisode}
          onBack={() => setView("phase1")}
          onFinalize={(ep) => {
            setEpisode(ep);
            setView("phase3");
          }}
        />
      )}

      {view === "phase3" && episode && (
        <Phase3Final
          episode={episode}
          onEpisodeUpdate={setEpisode}
          onBackToAudio={() => setView("phase2")}
          onBackToList={() => router.push("/podcast")}
        />
      )}
    </>
  );
}
