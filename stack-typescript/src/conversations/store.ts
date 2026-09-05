import { DatabaseSync } from "node:sqlite";
import type { ApprovalResponse, ConversationActivities, JobInput, Principal, Proposal, Resolution } from "./contracts.js";

// SQLite is the local PoC store. Application records are separate from Temporal storage.
export class ConversationStore implements ConversationActivities {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, tenant TEXT NOT NULL, owner TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS permissions (tenant TEXT, user TEXT, allowed INTEGER NOT NULL, PRIMARY KEY(tenant,user));
      CREATE TABLE IF NOT EXISTS records (tenant TEXT, id TEXT, amount INTEGER NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY(tenant,id));
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, conversation TEXT NOT NULL, record TEXT NOT NULL, status TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_job ON jobs(conversation) WHERE status = 'waiting';
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, conversation TEXT NOT NULL, event_key TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS resolutions (job TEXT, request TEXT, actor TEXT, choice TEXT, body TEXT NOT NULL, PRIMARY KEY(job,request,actor,choice));
      CREATE TABLE IF NOT EXISTS effects (job TEXT PRIMARY KEY, record TEXT NOT NULL, amount INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS context_snapshots (conversation TEXT, through_seq INTEGER, summary TEXT NOT NULL, PRIMARY KEY(conversation,through_seq));`);
  }
  close() { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private access(id: string, actor: Principal) {
    const row = this.db.prepare("SELECT id FROM conversations WHERE id=? AND tenant=? AND owner=?").get(id, actor.tenant, actor.user);
    if (!row) throw new Error("Conversation access denied");
  }
  create(id: string, actor: Principal) {
    this.db.prepare("INSERT INTO conversations VALUES (?,?,?)").run(id, actor.tenant, actor.user);
  }
  append(conversation: string, key: string, kind: string, body: unknown) {
    this.db.prepare("INSERT OR IGNORE INTO events(conversation,event_key,kind,body) VALUES (?,?,?,?)").run(conversation, key, kind, JSON.stringify(body));
  }
  history(id: string, actor: Principal) {
    this.access(id, actor);
    return this.db.prepare("SELECT seq,kind,body FROM events WHERE conversation=? ORDER BY seq").all(id)
      .map(row => ({ seq: Number(row.seq), kind: String(row.kind), body: JSON.parse(String(row.body)) }));
  }
  private proposal(input: JobInput): Proposal {
    const row = this.db.prepare("SELECT * FROM records WHERE tenant=? AND id=?").get(input.tenant, input.recordId);
    if (!row || row.status !== "pending") throw new Error("Record is not actionable");
    return { requestId: `${input.jobId}:${row.revision}`, revision: Number(row.revision), tool: "approve_record", input: { recordId: input.recordId, amount: Number(row.amount) } };
  }
  async prepare(input: JobInput): Promise<Proposal> {
    return this.transaction(() => {
      this.access(input.conversationId, input);
      const existing = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(input.jobId);
      if (existing && (existing.conversation !== input.conversationId || existing.record !== input.recordId)) throw new Error("Job identity conflict");
      this.db.prepare("INSERT INTO jobs VALUES (?,?,?,'waiting') ON CONFLICT(id) DO NOTHING").run(input.jobId, input.conversationId, input.recordId);
      const proposal = this.proposal(input);
      this.append(input.conversationId, `${proposal.requestId}:pending`, "approval-request", proposal);
      return proposal;
    });
  }
  async resolve(input: JobInput, proposal: Proposal, response: ApprovalResponse): Promise<Resolution> {
    return this.transaction(() => {
      this.access(input.conversationId, response);
      const old = this.db.prepare("SELECT body FROM resolutions WHERE job=? AND request=? AND actor=? AND choice=?").get(input.jobId, response.requestId, response.user, response.choice);
      if (old) return JSON.parse(String(old.body));
      if (response.requestId !== proposal.requestId) throw new Error("Approval identity mismatch");
      const allowed = this.db.prepare("SELECT allowed FROM permissions WHERE tenant=? AND user=?").get(response.tenant, response.user);
      if (response.choice === "allow" && !allowed?.allowed) {
        this.append(input.conversationId, `${proposal.requestId}:denied:${response.user}`, "permission-denied", { requestId: proposal.requestId });
        return { status: "denied" };
      }
      let result: Resolution;
      if (response.choice === "decline") {
        result = { status: "declined" };
      } else {
        const record = this.db.prepare("SELECT status FROM records WHERE tenant=? AND id=?").get(input.tenant, input.recordId);
        if (!record || record.status !== "pending") {
          this.append(input.conversationId, `${proposal.requestId}:unavailable`, "record-unavailable", { requestId: proposal.requestId });
          return { status: "denied" };
        }
        const current = this.proposal(input);
        if (current.revision !== proposal.revision || current.input.amount !== proposal.input.amount) {
          this.append(input.conversationId, `${current.requestId}:pending`, "approval-request", current);
          result = { status: "refresh", proposal: current };
        } else {
          // The synthetic business effect and idempotency receipt commit together.
          // A remote tool must implement the equivalent idempotency/conditional-write contract.
          this.db.prepare("INSERT INTO effects VALUES (?,?,?)").run(input.jobId, input.recordId, current.input.amount);
          this.db.prepare("UPDATE records SET status='approved' WHERE tenant=? AND id=? AND revision=?").run(input.tenant, input.recordId, proposal.revision);
          result = { status: "completed" };
        }
      }
      this.append(input.conversationId, `${proposal.requestId}:${response.choice}`, "approval-result", { response, result });
      if (result.status === "completed" || result.status === "declined")
        this.db.prepare("UPDATE jobs SET status=? WHERE id=?").run(result.status, input.jobId);
      this.db.prepare("INSERT INTO resolutions VALUES (?,?,?,?,?)").run(input.jobId, response.requestId, response.user, response.choice, JSON.stringify(result));
      return result;
    });
  }
  async compact(id: string, actor: Principal, keepRecent: number, summarize: (records: unknown[]) => Promise<string>) {
    if (!Number.isInteger(keepRecent) || keepRecent < 1) throw new Error("Keep at least one recent event");
    const history = this.history(id, actor);
    const older = history.slice(0, -keepRecent);
    if (!older.length) return;
    const summary = await summarize(older);
    if (!summary.trim()) throw new Error("Empty summary");
    this.access(id, actor);
    this.db.prepare("INSERT OR REPLACE INTO context_snapshots VALUES (?,?,?)").run(id, older.at(-1)!.seq, summary);
  }
  context(id: string, actor: Principal) {
    const history = this.history(id, actor);
    const snapshot = this.db.prepare("SELECT * FROM context_snapshots WHERE conversation=? ORDER BY through_seq DESC LIMIT 1").get(id);
    return { summary: snapshot ? String(snapshot.summary) : undefined, recent: history.filter(e => e.seq > Number(snapshot?.through_seq ?? 0)) };
  }
}
