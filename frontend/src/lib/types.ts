export interface Speaker {
  name: string;
  bio: string;
  voice_id: string;
}

export interface ScriptTurn {
  speaker_index: number;
  text: string;
  audio_path: string | null;
}

export interface Episode {
  id: string;
  title: string;
  speakers: Speaker[];
  prompt: string;
  length_minutes: number;
  script: ScriptTurn[] | null;
  phase: 1 | 2 | 3;
  final_audio_path: string | null;
  transcript: string | null;
  created_at: string;
  updated_at: string;
}

export interface EpisodeSummary {
  id: string;
  title: string;
  phase: 1 | 2 | 3;
  length_minutes: number;
  speakers: Speaker[];
  turn_count: number;
  created_at: string;
  updated_at: string;
}

export type ToastType = "success" | "error" | "info";

export interface ToastMessage {
  id: number;
  msg: string;
  type: ToastType;
}
