import {useEffect,useState,useSyncExternalStore} from 'react';
import {createImmediateShopping} from './immediate-shopping';
import type {ShoppingItem} from '../shared/shopping';
export function useImmediateShopping(items:ShoppingItem[]) {
 const [store]=useState(createImmediateShopping);
 const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
 const key=JSON.stringify(items.map(i=>({id:i.id,checked:i.checked})));
 useEffect(()=>store.reconcile(JSON.parse(key)),[store,key,snapshot]);
 return {...snapshot,toggle:store.toggle};
}
