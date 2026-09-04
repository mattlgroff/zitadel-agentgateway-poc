"use client";

import { useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type DynamicToolUIPart, type ToolUIPart } from "ai";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { PromptInput, PromptInputBody, PromptInputSubmit, PromptInputTextarea, type PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { ApprovalCard } from "@/components/approval-card";
import { beginLogin, token } from "@/lib/auth";

const stackUrl = process.env.NEXT_PUBLIC_STACK_URL ?? "http://localhost:5000";

function ToolPartView({ part }: { part: ToolUIPart | DynamicToolUIPart }) {
  const dynamic = part.type === "dynamic-tool";
  return <div data-tool-call-id={part.toolCallId}><Tool defaultOpen={part.state === "approval-requested"}><ToolHeader type={part.type as any} state={part.state} {...(dynamic ? { toolName: part.toolName } : {}) as any} /><ToolContent><ToolInput input={part.input} /><ToolOutput output={part.output} errorText={part.errorText} /></ToolContent></Tool></div>;
}

export default function Home() {
  const [input, setInput] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [resumeRunId, setResumeRunId] = useState("");
  useEffect(() => {
    setAccessToken(token() ?? "");
    setResumeRunId(new URLSearchParams(window.location.search).get("runId") ?? "");
  }, []);
  const transport = useMemo(() => new DefaultChatTransport({
    api: `${stackUrl}/chat`,
    headers: () => ({ authorization: `Bearer ${token() ?? ""}` }),
    prepareReconnectToStreamRequest: ({ id }) => ({ api: `${stackUrl}/runs/${encodeURIComponent(id)}/stream`, headers: { authorization: `Bearer ${token() ?? ""}` } }),
  }), []);
  const { messages, sendMessage, status, error } = useChat({ id: resumeRunId || undefined, resume: Boolean(resumeRunId), transport });
  const submit = (message: PromptInputMessage) => { if (message.text.trim()) { sendMessage({ text: message.text }); setInput(""); } };

  return <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-5 sm:px-8">
    <header className="mb-4 flex items-center justify-between border-b pb-4"><div><p className="text-xs uppercase tracking-[0.2em] text-lime-300">Agent platform harness</p><h1 className="text-2xl font-semibold">Timesheet review</h1></div>{accessToken ? <button className="rounded-md border px-3 py-2 text-sm" onClick={() => { localStorage.removeItem("access_token"); setAccessToken(""); }}>Sign out</button> : <button className="rounded-md bg-lime-300 px-3 py-2 text-sm font-medium text-black" onClick={() => void beginLogin()}>Sign in with Zitadel</button>}</header>
    <section className="flex min-h-0 flex-1 flex-col rounded-xl border bg-[var(--card)]" style={{ height: "calc(100vh - 11rem)" }}>
      <Conversation><ConversationContent>{messages.length === 0 ? <ConversationEmptyState title="Review pending timesheets" description="Sign in, then ask the agent to approve routine entries and pause on unusual ones." /> : messages.map((message) => <Message from={message.role} key={message.id}><MessageContent>{message.parts.map((part, index) => {
        if (part.type === "text") return <MessageResponse key={index}>{part.text}</MessageResponse>;
        if (part.type.startsWith("tool-") || part.type === "dynamic-tool") return <ToolPartView key={index} part={part as ToolUIPart | DynamicToolUIPart} />;
        if (part.type === "data-approval-request") { const data = part.data as any; return <ApprovalCard key={index} runId={data.runId} items={data.timesheets ?? data.items ?? []} stackUrl={stackUrl} accessToken={accessToken} />; }
        return null;
      })}</MessageContent></Message>)}</ConversationContent><ConversationScrollButton /></Conversation>
      <div className="border-t p-3">{error && <p className="mb-2 text-sm text-red-300">{error.message}</p>}<PromptInput onSubmit={submit}><PromptInputBody><PromptInputTextarea value={input} onChange={(event) => setInput(event.currentTarget.value)} placeholder="Review my pending timesheets..." disabled={!accessToken} /></PromptInputBody><PromptInputSubmit status={status} disabled={!accessToken || !input.trim()} /></PromptInput></div>
    </section>
    <footer className="pt-3 text-center text-xs text-neutral-400">AI-generated. Decisions above the threshold were made by you.</footer>
  </main>;
}
