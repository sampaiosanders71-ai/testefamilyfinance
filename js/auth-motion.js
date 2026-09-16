const AUTH_MOTION_STYLESHEET='css/auth-motion.css';
let stylesheetPromise=null;
let introToken=0;

function byId(id){return document.getElementById(id)}
function reducedMotion(){return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true}

function ensureStylesheet(){
  if(stylesheetPromise)return stylesheetPromise;
  stylesheetPromise=new Promise(resolve=>{
    const existing=document.querySelector('link[data-ff-auth-motion="true"]');
    if(existing){
      if(existing.sheet)return resolve();
      existing.addEventListener('load',resolve,{once:true});
      existing.addEventListener('error',resolve,{once:true});
      return;
    }
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href=AUTH_MOTION_STYLESHEET;
    link.dataset.ffAuthMotion='true';
    link.addEventListener('load',resolve,{once:true});
    link.addEventListener('error',resolve,{once:true});
    document.head.appendChild(link);
  });
  return stylesheetPromise;
}

function ensureMotionNodes(){
  const auth=byId('auth-view');
  if(!auth)return null;
  auth.classList.add('ff-auth-motion');

  let splash=byId('ff-auth-splash');
  if(!splash){
    splash=document.createElement('div');
    splash.id='ff-auth-splash';
    splash.className='ff-auth-splash';
    splash.setAttribute('aria-hidden','true');
    splash.innerHTML='<span class="ff-auth-mark">◉</span><span>family <strong>finance</strong></span>';
    auth.appendChild(splash);
  }

  let ambient=byId('ff-auth-ambient');
  if(!ambient){
    ambient=document.createElement('div');
    ambient.id='ff-auth-ambient';
    ambient.className='ff-auth-ambient';
    ambient.setAttribute('aria-hidden','true');
    auth.appendChild(ambient);
  }

  let wipe=byId('ff-auth-wipe');
  if(!wipe){
    wipe=document.createElement('div');
    wipe.id='ff-auth-wipe';
    wipe.className='ff-auth-wipe';
    wipe.setAttribute('aria-hidden','true');
    document.body.appendChild(wipe);
  }
  return {auth,splash,wipe};
}

export async function prepareAuthMotion({restart=false}={}){
  const token=++introToken;
  await ensureStylesheet();
  if(token!==introToken)return;
  const nodes=ensureMotionNodes();
  if(!nodes)return;
  const {auth,wipe}=nodes;
  wipe.classList.remove('is-running');
  document.documentElement.classList.remove('ff-app-revealing');
  auth.classList.remove('ff-auth-exit','ff-auth-busy','ff-auth-ready');

  if(!restart&&auth.dataset.ffIntroDone==='true'){
    auth.classList.add('ff-auth-ready','ff-auth-intro-done');
    return;
  }

  auth.classList.remove('ff-auth-intro-done');
  auth.dataset.ffIntroDone='true';
  if(reducedMotion()){
    auth.classList.add('ff-auth-ready','ff-auth-intro-done');
    return;
  }
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(token===introToken)auth.classList.add('ff-auth-ready');
  }));
}

export function setAuthMotionBusy(busy){
  ensureMotionNodes();
  byId('auth-view')?.classList.toggle('ff-auth-busy',Boolean(busy));
}

export function resetAuthMotion(){
  const auth=byId('auth-view');
  if(auth)auth.dataset.ffIntroDone='false';
  return prepareAuthMotion({restart:true});
}

export function revealAppWithMotion({onCover,onComplete}={}){
  const nodes=ensureMotionNodes();
  if(!nodes){onCover?.();onComplete?.();return}
  const {auth,wipe}=nodes;
  auth.classList.add('ff-auth-exit');
  if(reducedMotion()){
    onCover?.();
    onComplete?.();
    return;
  }
  document.documentElement.classList.add('ff-app-revealing');
  wipe.classList.remove('is-running');
  void wipe.offsetWidth;
  wipe.classList.add('is-running');
  window.setTimeout(()=>onCover?.(),430);
  window.setTimeout(()=>{
    wipe.classList.remove('is-running');
    document.documentElement.classList.remove('ff-app-revealing');
    onComplete?.();
  },920);
}

void prepareAuthMotion();
