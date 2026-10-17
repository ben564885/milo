import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { adminClient, agentClient, loadIdentities, type Person } from "@milo/shared";

const ids = () => loadIdentities();

export async function milo() {
  const i = await agentClient(ids().milo.handle).getIdentity(ids().milo.handle);
  return i;
}

export async function availability() {
  const m = await milo();
  await m.refresh();
  return {
    slack: Boolean(ids().slack?.connectionId && ids().slack?.channelId),
    imessage: Boolean(m.imessageNumber),
    phone: Boolean(m.phoneNumber),
    phoneNumber: (m.phoneNumber as any)?.number as string | undefined,
  };
}

// ---------- Slack ----------
export async function slackPost(text: string, threadTs?: string) {
  const s = ids().slack!;
  const action = await adminClient().slack.sendMessage(s.connectionId, {
    conversationId: s.channelId, text, threadTs: threadTs ?? null, idempotencyKey: `milo:${randomUUID()}`,
  });
  let a = action;
  for (let i = 0; i < 10 && a.status === "sending"; i++) {
    await new Promise((r) => setTimeout(r, 400));
    a = await adminClient().slack.getAction(s.connectionId, action.id);
  }
  return a.messageTs ?? undefined;
}

export async function slackUpdate(ts: string, text: string) {
  const s = ids().slack!;
  await adminClient().slack.updateMessage(s.connectionId, s.channelId, ts, text, { idempotencyKey: `milo-upd:${randomUUID()}` }).catch((e) => console.warn("[slack] update failed:", e.message));
}

export async function slackUpload(path: string, threadTs: string, comment: string) {
  const s = ids().slack!;
  await adminClient().slack.uploadFile(s.connectionId, {
    conversationId: s.channelId, threadTs, filename: basename(path), title: "call recording",
    initialComment: comment, contentBase64: readFileSync(path).toString("base64"), idempotencyKey: `milo-file:${randomUUID()}`,
  });
}

export const mention = (p?: Person) => (p?.slack_user ? `<@${p.slack_user}>` : p?.name ?? "someone");

// ---------- iMessage ----------
export async function imessageSend(to: string, text: string) {
  const m = await milo();
  const msg = await m.sendIMessage({ to, text, idempotencyKey: `milo-im:${randomUUID()}` });
  return { id: msg.id, conversationId: msg.conversationId };
}

/** Send in an existing conversation, optionally as a threaded reply under one message. */
export async function imessageInConversation(conversationId: string, text: string, replyToMessageId?: string) {
  const m = await milo();
  await m.sendIMessage({ conversationId, text, replyToMessageId: replyToMessageId ?? null, idempotencyKey: `milo-im:${randomUUID()}` });
}

// ---------- Phone ----------
export async function placeHostedCall(to: string, reason: string, voicemail: string) {
  const m = await milo();
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const call = await m.placeCall({ toNumber: to, mode: "hosted_agent", reason: reason.slice(0, 2000), onVoicemail: "leave_message", voicemailMessage: voicemail.slice(0, 1000), hostedAgentAuthorityMode: "contact_scoped" } as any);
      return call.id as string;
    } catch (err: any) {
      if (err?.statusCode === 503) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      throw err;
    }
  }
  throw new Error("Voice AI at capacity");
}

// ---------- A2A ----------
export async function askOwnerAgent(ownerHandle: string, text: string, timeoutMs: number) {
  const inkbox = agentClient(ids().milo.handle);
  const m = await milo();
  const client = await m.a2aClient();
  const target = await client.fetchCard(`https://inkbox.ai/a2a/${ownerHandle}/card`);
  const sent: any = await client.send(target, { text });
  const taskId = sent.task?.id ?? sent.id;
  const deadline = Date.now() + timeoutMs;
  let task: any = sent.task;
  while (Date.now() < deadline) {
    task = await client.getTask(target, taskId);
    const st = task.status?.state as string;
    if (/COMPLETED|INPUT_REQUIRED|FAILED|REJECTED|CANCELED/.test(st)) break;
    await new Promise((r) => setTimeout(r, 700));
  }
  void inkbox;
  const last = [...(task.history ?? [])].reverse().find((h: any) => /AGENT/.test(h.role));
  const text2 = last?.parts?.find((p: any) => p.text)?.text as string | undefined;
  const data = last?.parts?.find((p: any) => p.data)?.data as Record<string, any> | undefined;
  return { state: String(task.status?.state ?? "unknown"), text: text2, data };
}

export async function a2aProgress(taskId: string, text: string) {
  const m = await milo();
  await m.a2aReply(taskId, { intent: "progress", text }).catch((e) => console.warn("[a2a] progress failed:", e.message));
}

export async function a2aComplete(taskId: string, text: string, data: Record<string, unknown>) {
  const m = await milo();
  await m.a2aReply(taskId, { intent: "complete", parts: [{ text }, { data }] });
}
