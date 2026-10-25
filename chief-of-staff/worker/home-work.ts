import type {Env} from './env';
import type {Item,Project} from '../shared/types';
import {all,now} from './db';
/** Home's task inventory is not an interruption queue. Muting/snoozing changes alerts, not ownership. */
export async function homeWork(env:Env) {
 const [tasks,projects]=await Promise.all([
  all<Item>(env,`SELECT * FROM items WHERE status='open' AND kind IN ('task','commitment','waiting','reminder')
   AND (kind!='reminder' OR due_at IS NULL OR due_at<=?) ORDER BY priority,due_at IS NULL,due_at,created_at`,now()),
  all<Project>(env,`SELECT p.*, (SELECT count(*) FROM items i WHERE i.project_id=p.id AND i.status='done') AS done_count
   FROM projects p WHERE EXISTS(SELECT 1 FROM items i WHERE i.project_id=p.id AND i.status='open') ORDER BY p.updated_at DESC`),
 ]);
 return {tasks,projects};
}
