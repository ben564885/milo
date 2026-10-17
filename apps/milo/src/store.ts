import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, type Decision, type Step, type Urgency } from "@milo/shared";

export type LogLine = { at: string; step: Step | "done" | "info"; text: string; ok?: boolean };

export type Request = {
  id: string;
  question: string;
  context: string;
  file?: string;
  urgency: Urgency;
  requester: string;
  a2aTaskId?: string;
  owner?: string;
  target?: string;
  step: Step | "done";
  status: "running" | "done" | "failed";
  log: LogLine[];
  slack?: { connectionId: string; channel: string; threadTs?: string; statusTs?: string };
  imessageId?: string;
  imessageConversationId?: string;
  callId?: string;
  decision?: Decision;
  replied?: boolean;
  options?: string[];
  listening?: boolean;
  superseded?: boolean;
  call?: { transcript: string; recordingPath?: string; seconds: number; joined: string[] };
  createdAt: string;
};

mkdirSync(join(ROOT, "data"), { recursive: true });
const db = new DatabaseSync(join(ROOT, "data/milo.db"));
db.exec("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, created_at TEXT, json TEXT)");

const listeners = new Set<(r: Request) => void>();
export const onChange = (fn: (r: Request) => void) => { listeners.add(fn); return () => listeners.delete(fn); };

export function save(r: Request) {
  db.prepare("INSERT INTO requests (id, created_at, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json")
    .run(r.id, r.createdAt, JSON.stringify(r));
  for (const fn of listeners) fn(r);
}

export function get(id: string): Request | undefined {
  const row = db.prepare("SELECT json FROM requests WHERE id = ?").get(id) as { json: string } | undefined;
  return row ? JSON.parse(row.json) : undefined;
}

export function list(limit = 20): Request[] {
  return (db.prepare("SELECT json FROM requests ORDER BY created_at DESC LIMIT ?").all(limit) as { json: string }[]).map((r) => JSON.parse(r.json));
}

export function find(pred: (r: Request) => boolean): Request | undefined {
  return list(50).find(pred);
}

export function reset() { db.exec("DELETE FROM requests"); }

/** On startup, requests that were mid-escalation can't resume; mark them failed. */
export function failInterrupted() {
  for (const r of list(50)) {
    if (r.status !== "running") continue;
    r.status = "failed";
    r.log.push({ at: new Date().toISOString(), step: "info", text: "Milo restarted during this request.", ok: false });
    save(r);
  }
}
