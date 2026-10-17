import { Inkbox } from "@inkbox/sdk";
import { env } from "./env.ts";

let admin: Inkbox | undefined;

/** Admin-scoped client (org-wide). */
export function adminClient(): Inkbox {
  admin ??= new Inkbox({ apiKey: env("INKBOX_API_KEY") });
  return admin;
}

const agents = new Map<string, Inkbox>();

/** Agent-scoped client for one identity. Keys live in .env.local as INKBOX_KEY_<HANDLE>. */
export function agentClient(handle: string): Inkbox {
  let c = agents.get(handle);
  if (!c) {
    c = new Inkbox({ apiKey: env(keyVar(handle)) });
    agents.set(handle, c);
  }
  return c;
}

export function keyVar(handle: string) {
  return "INKBOX_KEY_" + handle.toUpperCase().replace(/-/g, "_");
}
