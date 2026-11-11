import {useEffect,useRef,type ReactNode} from 'react';

export function Modal({label,onClose,children,className=''}:{label:string;onClose:()=>void;children:ReactNode;className?:string}){
 const dialog=useRef<HTMLDialogElement>(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{
  const el=dialog.current!,previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
  el.showModal();document.body.style.overflow='hidden';
  el.querySelector<HTMLElement>('[role=spinbutton]')?.focus({preventScroll:true});
  return()=>{el.close();document.body.style.overflow=overflow;previous?.focus({preventScroll:true});};
 },[]);
 return <dialog ref={dialog} className={'dn-modal '+className} aria-label={label} onCancel={e=>{e.preventDefault();close.current();}}>{children}</dialog>;
}
