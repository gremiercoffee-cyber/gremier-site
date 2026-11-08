/** Shared across conversation, brain dumps and the periodic inbox pass. */
export const MAX_FOLDERS_PER_AREA = 2;

export const PROJECT_POLICY = `Folders (projects) keep the home screen calm. Each area of life (Coffee, Yeshiva, Personal…) holds a few folders, normally at most ${MAX_FOLDERS_PER_AREA}. A task that fits no folder simply sits loose in its area. That is fine and is the default.
- NEVER create a folder on your own. Not for a single new task, not for a dated work session ("this afternoon", "Monday's orders"), not because several tasks share a topic. Only create_project when the user asks for that folder, or said yes when you asked in this conversation.
- Filing a new task, reminder, commitment or waiting item: set its category (area). Put it in an existing folder of that area only when it clearly serves that folder's goal; otherwise leave it loose in the area.
- When you think new work deserves its own folder, ask in the chat in one short line, naming the area's existing folders: "Should I put this in <folder A> or <folder B>, or start a new folder '<name>' in <area>?" If the area already has ${MAX_FOLDERS_PER_AREA} folders, say it would be a third one. Then do what they answer.
- A list of things to do now or this afternoon is just tasks due today. No session folder.
- Never create duplicate tasks; move existing ones with update_item. Preserve the user's own naming and assignments.
- Organizing is internal filing, not permission to start an AI research job, send messages or change reminders.`;
