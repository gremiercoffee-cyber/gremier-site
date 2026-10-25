import {useEffect,useState,useSyncExternalStore} from 'react';
import {createImmediateCompletions} from './immediate-completions';
export function useImmediateCompletions(ids:string[]) {
 const [store]=useState(createImmediateCompletions);
 const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
 const key=JSON.stringify(ids);
 useEffect(()=>store.reconcile(JSON.parse(key)),[store,key,snapshot]);
 return {...snapshot,complete:store.complete};
}
