/* The builder's room owns presentation, scrolling and focus; the planner still owns every choice. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id), reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let world, backdrop, slot, savedY = 0, savedTop = '', closing = false, lastFocus;
  const backgrounds = new Map();
  // The site's checkout router creates fresh state objects; keep the room underneath its layers.
  for(const method of ['pushState','replaceState']){
    const original=history[method].bind(history);
    history[method]=function(state,title,url){
      if(world&&!closing&&history.state?.bbBuild&&state?.page==='coffeebars')state={bbDirect:history.state.bbDirect,...state,bbBuild:true};
      return original(state,title,url);
    };
  }
  const upperLayer = () => document.querySelector('.modal-overlay.open,#pdDrawer.open,#cartDrawer.open');
  function restore() {
    const planner=$('planner');if(slot?.parentNode&&planner)slot.replaceWith(planner);slot=null;
    const chat=$('barChat');if(chat&&world?.contains(chat))document.body.append(chat);
    backgrounds.forEach((old,el)=>{el.classList.remove('bb-world-background');el.inert=old;});backgrounds.clear();
    backdrop?.remove();backdrop=null;world?.remove();world=null;document.body.classList.remove('bb-world-on','bbx-sheet-on');document.querySelectorAll('.bb-confirm.open').forEach(el=>el.classList.remove('open'));document.body.style.top=savedTop;window.scrollTo(0,savedY);
  }
  function sync(on, step) {
    if(!on)return;
    if(!world){
      closing=false;savedY=scrollY;savedTop=document.body.style.top;lastFocus=document.activeElement;
      const planner=$('planner');slot=document.createComment('coffee-bar-builder');planner.before(slot);
      world=document.createElement('section');world.id='bbWorld';world.className='bb-world';world.setAttribute('role','dialog');world.setAttribute('aria-modal','true');world.tabIndex=-1;backdrop=document.createElement('div');backdrop.id='bbWorldBackdrop';backdrop.className='bb-world-backdrop';backdrop.setAttribute('aria-hidden','true');document.body.append(backdrop,world);world.append(planner);
      [...document.body.children].forEach(el=>{
        if(el===world||el===backdrop||el.matches('script,style,link,#barChat,.modal-overlay,.drawer,.drawer-overlay,.bb-confirm,#pdDrawer,#pdBackdrop,#drawerBackdrop,.drawer-backdrop,#cartOverlay,#toast,.toast'))return;
        backgrounds.set(el,el.inert);el.classList.add('bb-world-background');el.inert=true;
      });
      document.body.style.top=`-${savedY}px`;document.body.classList.add('bb-world-on');
      world.classList.add('ready');
      if(!reduced())world.animate([{opacity:0},{opacity:1}],{duration:100});
      requestAnimationFrame(()=>{world?.querySelector('[data-bb-exit]')?.focus({preventScroll:true});dispatchEvent(new Event('resize'));});
    }
    world.setAttribute('aria-label',document.body.classList.contains('rtl')?'בונים בר קפה':'Build your coffee bar');
    world.dataset.step=step;
    const chat=$('barChat');if(chat&&!world.contains(chat))world.append(chat);
  }
  function leave(done) {
    if(!world){done();return;}closing=true;restore();closing=false;done();
    const start = document.querySelector('[data-bb-start]');
    (lastFocus?.getClientRects().length ? lastFocus : start)?.focus?.({preventScroll:true});
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
  window.CoffeeBarWorld={prepare(){},sync,leave,isOpen:()=>!!world,scrollTop(){if(world)world.scrollTo({top:0,behavior:'instant'});else window.scrollTo({top:0,behavior:'auto'});}};
})();
