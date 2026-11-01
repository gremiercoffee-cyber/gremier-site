/* The builder's room owns presentation, scrolling and focus; the planner still owns every choice. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id), reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let world, slot, curtain, origin, savedY = 0, savedTop = '', epoch = 0, closing = false, previousStep, lastFocus;
  const backgrounds = new Map();
  // The site's checkout router creates fresh state objects; keep the room underneath its layers.
  for(const method of ['pushState','replaceState']){
    const original=history[method].bind(history);
    history[method]=function(state,title,url){
      if(world&&!closing&&history.state?.bbBuild&&state?.page==='coffeebars')state={...state,bbBuild:true};
      return original(state,title,url);
    };
  }
  const upperLayer = () => document.querySelector('.modal-overlay.open,#pdDrawer.open,#cartDrawer.open');
  function point() {
    const r = document.querySelector('[data-bb-start]')?.getBoundingClientRect();
    return r ? { x:r.x+r.width/2, y:Math.max(20,Math.min(innerHeight-20,r.y+r.height/2)) } : { x:innerWidth/2, y:innerHeight*.65 };
  }
  function cover(reverse, done) {
    curtain?.remove();curtain=document.createElement('div');curtain.className='bb-world-door';curtain.setAttribute('aria-hidden','true');document.body.append(curtain);
    const p=reverse?point():(origin||point()), radius=Math.hypot(Math.max(p.x,innerWidth-p.x),Math.max(p.y,innerHeight-p.y));
    const small=`circle(0px at ${p.x}px ${p.y}px)`,large=`circle(${radius}px at ${p.x}px ${p.y}px)`;
    const frames=reduced()?[{opacity:reverse?1:0},{opacity:reverse?0:1}]:[{clipPath:reverse?large:small},{clipPath:reverse?small:large}];
    const el=curtain,a=el.animate(frames,{duration:reduced()?100:500,easing:'ease-in-out',fill:'forwards'});
    a.finished.then(()=>done(el)).catch(()=>{});
  }
  function restore() {
    const planner=$('planner');if(slot?.parentNode&&planner)slot.replaceWith(planner);slot=null;
    const chat=$('barChat');if(chat&&world?.contains(chat))document.body.append(chat);
    backgrounds.forEach((old,el)=>{el.classList.remove('bb-world-background');el.inert=old;});backgrounds.clear();
    world?.remove();world=null;document.body.classList.remove('bb-world-on','bbx-sheet-on');document.querySelectorAll('.bb-confirm.open').forEach(el=>el.classList.remove('open'));document.body.style.top=savedTop;window.scrollTo(0,savedY);previousStep=null;
  }
  function sync(on, step) {
    if(!on)return;
    if(!world){
      const token=++epoch;closing=false;savedY=scrollY;savedTop=document.body.style.top;lastFocus=document.activeElement;
      const planner=$('planner');slot=document.createComment('coffee-bar-builder');planner.before(slot);
      world=document.createElement('section');world.id='bbWorld';world.className='bb-world';world.setAttribute('role','dialog');world.setAttribute('aria-modal','true');world.tabIndex=-1;document.body.append(world);world.append(planner);
      [...document.body.children].forEach(el=>{
        if(el===world||el.matches('script,style,link,#barChat,.modal-overlay,.drawer,.drawer-overlay,.bb-confirm,#pdDrawer,#pdBackdrop,#drawerBackdrop,.drawer-backdrop,#cartOverlay,#toast,.toast'))return;
        backgrounds.set(el,el.inert);el.classList.add('bb-world-background');el.inert=true;
      });
      document.body.style.top=`-${savedY}px`;document.body.classList.add('bb-world-on');
      cover(false,el=>{if(epoch!==token)return;world?.classList.add('ready');
        el.animate([{opacity:1},{opacity:0}],{duration:reduced()?80:200,fill:'forwards'}).finished.then(()=>el.remove()).catch(()=>{});
        world?.querySelector('[data-bb-exit]')?.focus({preventScroll:true});dispatchEvent(new Event('resize'));
      });
    }else if(closing){++epoch;closing=false;curtain?.remove();world.classList.add('ready');}
    world.setAttribute('aria-label',document.body.classList.contains('rtl')?'בונים בר קפה':'Build your coffee bar');
    world.dataset.step=step;
    if(previousStep&&previousStep!==step&&!reduced()){const from=world.style.getPropertyValue('--bb-room-x')||'38%',to=from==='38%'?'44%':'38%';world.style.setProperty('--bb-room-x',to);world.animate([{'--bb-room-x':from},{'--bb-room-x':to}],{duration:700,easing:'ease-in-out'});}
    previousStep=step;
    const chat=$('barChat');if(chat&&!world.contains(chat))world.append(chat);
  }
  function leave(done) {
    if(!world){done();return;}if(closing)return;closing=true;const token=++epoch;
    // Cover the room briefly, restore the original page, then close the door into its start button.
    curtain?.remove();curtain=document.createElement('div');curtain.className='bb-world-door';document.body.append(curtain);
    curtain.animate([{opacity:0},{opacity:1}],{duration:reduced()?70:140,fill:'forwards'}).finished.then(()=>{
      if(token!==epoch)return;restore();closing=false;done();
      cover(true,el=>{if(token!==epoch)return;el.remove();origin=null;(document.querySelector('[data-bb-start]')||lastFocus)?.focus?.({preventScroll:true});});
    }).catch(()=>{});
  }
  function close() { if(world&&!closing)world.querySelector('[data-bb-exit]')?.click(); }
  addEventListener('keydown',e=>{
    if(!world||closing||upperLayer())return;
    if(e.key==='Escape'){
      const confirmation=document.querySelector('.bb-confirm.open');if(confirmation){e.preventDefault();e.stopImmediatePropagation();confirmation.classList.remove('open');return;}
      const picker=world.querySelector('.bbx-sheet-x');if(picker){e.preventDefault();picker.click();return;}
      const chat=$('barChat');if(chat?.classList.contains('open')){chat.querySelector('[data-bc-close]')?.click();return;}
      e.preventDefault();e.stopImmediatePropagation();close();return;
    }
    if(e.key==='Tab'){
      const scope=document.querySelector('.bb-confirm.open')||world.querySelector('.bbx-sheet-box')||world;
      const items=[...scope.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(el=>el.getClientRects().length);
      const first=items[0],last=items[items.length-1];if(!first){e.preventDefault();world.focus();return;}
      if(e.shiftKey&&(document.activeElement===first||!scope.contains(document.activeElement))){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&(document.activeElement===last||!scope.contains(document.activeElement))){e.preventDefault();first.focus();}
    }
  },true);
  window.CoffeeBarWorld={prepare(){origin=point();},sync,leave,isOpen:()=>!!world,scrollTop(){if(world)world.scrollTo({top:0,behavior:'instant'});else window.scrollTo({top:0,behavior:'auto'});}};
})();
