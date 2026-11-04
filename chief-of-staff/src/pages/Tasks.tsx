import HelperJobs from '../components/HelperJobs';
import { ResearchList } from "../components/ResearchChats";
import type { JobChatRow } from "../api";

/** Work your Chief of Staff does for you: research chats and the computer helper's jobs. */
export default function Tasks({ onAsk, refreshKey, jobs, onOpenResearch, onJobsChanged }: {
  onAsk: (text: string) => void; refreshKey: number;
  jobs: JobChatRow[]; onOpenResearch: (id: string) => void; onJobsChanged: () => void;
}) {
  return (
    <div className="space-y-4">
      <HelperJobs refreshKey={refreshKey} />
      <ResearchList jobs={jobs} onOpen={onOpenResearch} onChanged={onJobsChanged} onNew={() => onAsk("Research ")} />
    </div>
  );
}
