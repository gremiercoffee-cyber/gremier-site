import { ResearchList } from "../components/ResearchChats";
import type { JobChatRow } from "../api";

/** Work your Chief of Staff does for you: research chats. */
export default function Tasks({ onAsk, refreshKey, jobs, onOpenResearch, onJobsChanged }: {
  onAsk: (text: string) => void; refreshKey: number;
  jobs: JobChatRow[]; onOpenResearch: (id: string) => void; onJobsChanged: () => void;
}) {
  return (
    <div className="space-y-4">
      <ResearchList jobs={jobs} onOpen={onOpenResearch} onChanged={onJobsChanged} onNew={() => onAsk("Research ")} />
    </div>
  );
}
