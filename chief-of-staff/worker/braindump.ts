/** Brain Dump: unstructured thoughts in, cleanly separated items out (cheap "fast" tier). */
import type { ActionNote } from "../shared/types";
import type { Env } from "./env";
import { assistantTools } from "./assistant";
import { buildContext } from "./assistant";
import { getProvider } from "./ai";
import { now, run, uid } from "./db";

const BRAIN_DUMP_SYSTEM = `You are the user's Chief of Staff, sorting a brain dump.

Read the dump and file every distinct thing with create_item, choosing the right kind:
task (to do), reminder (at a time — set due_at), commitment (promised to someone — set person),
waiting (waiting on someone — set person), idea (a thought, not a commitment).
Use remember for durable facts or preferences. Use an existing project name when one clearly fits.
Do not create duplicates of open items already listed in the context. Do not invent details.
When done, reply with a two-sentence summary of what you filed.`;

export async function processBrainDump(env: Env, raw: string) {
  const id = uid();
  await run(env, "INSERT INTO brain_dumps (id, raw, created_at) VALUES (?, ?, ?)", id, raw, now());
  const notes: ActionNote[] = [];
  try {
    const result = await getProvider(env).runAgent({
      tier: "fast",
      purpose: "brain_dump",
      system: BRAIN_DUMP_SYSTEM,
      context: await buildContext(env, "text"),
      history: [{ role: "user", content: raw }],
      // Brain dumps never queue deletions: only filing tools.
      tools: assistantTools(env, "brain_dump", notes).filter((t) =>
        ["create_item", "create_project", "remember", "search_items"].includes(t.name),
      ),
      maxToolRounds: 4,
    });
    await run(env, "UPDATE brain_dumps SET status = 'processed', summary = ?, result = ? WHERE id = ?",
      result.text, JSON.stringify(notes), id);
    return { id, summary: result.text, actions: notes, status: "processed" };
  } catch (e) {
    await run(env, "UPDATE brain_dumps SET status = 'failed', summary = ? WHERE id = ?",
      e instanceof Error ? e.message : String(e), id);
    throw e;
  }
}
