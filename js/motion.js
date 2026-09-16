const MOTION_STYLESHEET='css/motion.css';
const MONEY_IDS=['stat-balance','stat-month-result','stat-projected','stat-income','stat-expense','stat-card-expense'];
const moneyFormatter=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
let stylesheetPromise=null;
let introRun=0;
let countUpArmed=false;
let dashboardReady=false;
let queuedMoney=null;

function reducedMotion(){return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true}
function sleep(ms){return new Promise(resolve=>window.setTimeout(resolve,ms))}
function byId(id){return document.getElementById(id)}

function ensureStyles(){
  if(stylesheetPromise)return stylesheetPromise;
  stylesheetPromise=new Promise(resolve=>{
    const old=document.querySelector('link[data-ff-motion="true"]');
    if(old){if(old.sheet)return resolve();old.addEventListener('load',resolve,{once:true});old.addEventListener('error',resolve,{once:true});return}
    const link=document.createElement('link');
    link.rel='stylesheet';link.href=MOTION_STYLESHEET;link.dataset.ffMotion='true';
    link.addEventListener('load',resolve,{once:true});link.addEventListener('error',resolve,{once:true});
    document.head.appendChild(link);
  });
  return stylesheetPromise;
}

function removeNode(id){byId(id)?.remove()}
function parseBRL(text=''){
  const normalized=String(text).replace(/\s/g,'').replace(/R\$/g,'').replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,'');
  const value=Number(normalized);
  return Number.isFinite(value)?value:0;
}

function targetBrandRect(){
  const desktop=document.querySelector('#auth-view .auth-brand .brand-lockup');
  if(desktop){const style=getComputedStyle(desktop);const rect=desktop.getBoundingClientRect();if(style.display!=='none'&&rect.width>4&&rect.height>4)return rect}
  return null;
}

async function animateSplashBrand(brand){
  if(reducedMotion())return;
  brand.classList.add('is-entering');
  await sleep(560);
  const target=targetBrandRect();
  if(!target)return;
  const endLeft=Math.max(16,target.left);
  const endTop=Math.max(14,target.top);
  const startWidth=Math.max(1,brand.getBoundingClientRect().width);
  const scale=Math.max(.66,Math.min(1,target.width/startWidth));
  brand.animate([
    {left:'50%',top:'45%',transform:'translate(-50%,-50%) scale(1)',opacity:1},
    {left:`${endLeft}px`,top:`${endTop}px`,transform:`translate(0,0) scale(${scale})`,opacity:1}
  ],{duration:620,easing:'cubic-bezier(.22,.86,.26,1)',fill:'forwards'});
  await sleep(620);
}

export async function startAuthIntro({restart=false}={}){
  const run=++introRun;
  await ensureStyles();
  if(run!==introRun)return;
  const auth=byId('auth-view');
  if(!auth||auth.classList.contains('hidden'))return;
  if(!restart&&auth.dataset.ffMotionIntro==='done')return;
  auth.dataset.ffMotionIntro='done';
  auth.classList.add('ff-auth-intro');
  auth.classList.remove('ff-auth-fields-in');
  removeNode('ff-entry-splash');

  const splash=document.createElement('div');
  splash.id='ff-entry-splash';splash.className='ff-entry-splash';splash.setAttribute('aria-hidden','true');
  const brand=document.createElement('div');
  brand.className='ff-entry-splash-brand';
  brand.innerHTML='<span class="brand-mark">◉</span><span>family <strong>finance</strong></span>';
  splash.appendChild(brand);document.body.appendChild(splash);

  if(reducedMotion()){
    splash.remove();auth.classList.add('ff-auth-fields-in');return;
  }
  await animateSplashBrand(brand);
  if(run!==introRun)return;
  splash.classList.add('is-leaving');
  auth.classList.add('ff-auth-fields-in');
  await sleep(350);
  splash.remove();
}

export function restartAuthIntro(){
  const auth=byId('auth-view');
  if(auth)auth.dataset.ffMotionIntro='';
  return startAuthIntro({restart:true});
}

export function setLoginButtonMotion(busy,mode='login',phase='auth'){
  const btn=byId('auth-submit');
  if(!btn)return;
  document.documentElement.classList.toggle('ff-login-busy',Boolean(busy));
  btn.classList.toggle('ff-login-capsule',Boolean(busy));
  if(busy){
    btn.innerHTML='<span class="ff-login-spinner" aria-hidden="true"></span>';
    btn.setAttribute('aria-label',phase==='data'?'Carregando seus dados':(mode==='register'?'Criando conta':'Entrando'));
  }else{
    btn.textContent=mode==='register'?'Criar conta':'Entrar';
    btn.setAttribute('aria-label',mode==='register'?'Criar conta':'Entrar');
  }
}

function ensureWipe(){
  let wipe=byId('ff-entry-wipe');
  if(!wipe){wipe=document.createElement('div');wipe.id='ff-entry-wipe';wipe.className='ff-entry-wipe';wipe.setAttribute('aria-hidden','true');document.body.appendChild(wipe)}
  return wipe;
}

function finishDashboardReveal(onComplete){
  dashboardReady=true;
  document.documentElement.classList.remove('ff-entry-transition');
  const app=byId('app-view');
  app?.classList.add('ff-dashboard-enter');
  window.setTimeout(()=>app?.classList.remove('ff-dashboard-enter'),450);
  onComplete?.();
  if(queuedMoney)runQueuedCountUp();
}

export function revealDashboard({onCovered,onComplete}={}){
  countUpArmed=true;dashboardReady=false;queuedMoney=null;
  const wipe=ensureWipe();
  if(reducedMotion()){
    onCovered?.();finishDashboardReveal(onComplete);return;
  }
  document.documentElement.classList.add('ff-entry-transition');
  wipe.classList.remove('is-running');void wipe.offsetWidth;wipe.classList.add('is-running');
  window.setTimeout(()=>onCovered?.(),430);
  window.setTimeout(()=>{wipe.classList.remove('is-running');finishDashboardReveal(onComplete)},910);
}

function runQueuedCountUp(){
  const targets=queuedMoney;queuedMoney=null;
  if(!targets||!countUpArmed)return;
  countUpArmed=false;
  if(reducedMotion()){
    targets.forEach(({el,value})=>{el.textContent=moneyFormatter.format(value)});
    return;
  }
  const duration=900;
  const start=performance.now();
  const frame=now=>{
    const t=Math.min(1,(now-start)/duration);
    const eased=1-Math.pow(1-t,3);
    targets.forEach(({el,value})=>{el.textContent=moneyFormatter.format(value*eased)});
    if(t<1)requestAnimationFrame(frame);
    else targets.forEach(({el,value})=>{el.textContent=moneyFormatter.format(value)});
  };
  requestAnimationFrame(frame);
}

export function queueDashboardCountUp(){
  if(!countUpArmed)return;
  const targets=MONEY_IDS.map(id=>{
    const el=byId(id);return el?{el,value:parseBRL(el.textContent)}:null;
  }).filter(Boolean);
  if(!targets.length){countUpArmed=false;return}
  targets.forEach(({el})=>{el.textContent=moneyFormatter.format(0)});
  queuedMoney=targets;
  if(dashboardReady)runQueuedCountUp();
}

