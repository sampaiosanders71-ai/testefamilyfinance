const MONEY_IDS=['stat-balance','stat-month-result','stat-projected','stat-income','stat-expense','stat-card-expense'];
const moneyFormatter=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
let introGeneration=0;

function byId(id){return document.getElementById(id)}
function sleep(ms){return new Promise(resolve=>window.setTimeout(resolve,ms))}
function reducedMotion(){return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true}

function parseBRL(text=''){
  const normalized=String(text).replace(/\s/g,'').replace(/R\$/g,'').replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,'');
  const value=Number(normalized);
  return Number.isFinite(value)?value:0;
}

function visibleDesktopBrandRect(){
  const target=document.querySelector('#auth-view .auth-brand .brand-lockup');
  if(!target)return null;
  const style=getComputedStyle(target),rect=target.getBoundingClientRect();
  return style.display!=='none'&&rect.width>4&&rect.height>4?rect:null;
}

function buildSplash(){
  byId('ff-motion-splash')?.remove();
  const splash=document.createElement('div');
  splash.id='ff-motion-splash';splash.className='ff-motion-splash';splash.setAttribute('aria-hidden','true');
  const brand=document.createElement('div');
  brand.className='ff-motion-splash-brand';
  brand.innerHTML='<span class="brand-mark">◉</span><span>family <strong>finance</strong></span>';
  splash.appendChild(brand);document.body.appendChild(splash);
  return {splash,brand};
}

async function moveBrand(brand){
  brand.classList.add('is-in');
  await sleep(reducedMotion()?160:760);
  if(reducedMotion())return;

  // Pequena pausa proposital: permite que o usuário leia a marca antes do movimento.
  await sleep(280);

  const target=visibleDesktopBrandRect();
  if(target){
    const width=Math.max(1,brand.getBoundingClientRect().width);
    const scale=Math.max(.66,Math.min(1,target.width/width));
    brand.animate([
      {left:'50%',top:'46%',transform:'translate(-50%,-50%) scale(1)',opacity:1},
      {left:`${Math.max(16,target.left)}px`,top:`${Math.max(14,target.top)}px`,transform:`translate(0,0) scale(${scale})`,opacity:1}
    ],{duration:800,easing:'cubic-bezier(.22,.80,.24,1)',fill:'forwards'});
    await sleep(800);
  }else{
    brand.animate([
      {left:'50%',top:'46%',transform:'translate(-50%,-50%) scale(1)',opacity:1},
      {left:'22px',top:'24px',transform:'translate(0,0) scale(.78)',opacity:1}
    ],{duration:760,easing:'cubic-bezier(.22,.80,.24,1)',fill:'forwards'});
    await sleep(760);
  }
}

export async function playAuthIntro({force=false}={}){
  const generation=++introGeneration;
  const auth=byId('auth-view');
  if(!auth||auth.classList.contains('hidden'))return;
  if(!force&&auth.dataset.ffMotionV5==='done')return;
  auth.dataset.ffMotionV5='done';
  auth.classList.add('ff-motion-intro');
  auth.classList.remove('ff-motion-panel-in','ff-motion-fields-in');

  const {splash,brand}=buildSplash();
  await moveBrand(brand);
  if(generation!==introGeneration)return;

  auth.classList.add('ff-motion-panel-in');
  await sleep(reducedMotion()?60:520);
  auth.classList.add('ff-motion-fields-in');

  // Aguarda o stagger terminar antes de liberar totalmente a tela.
  await sleep(reducedMotion()?100:780);
  splash.classList.add('is-out');
  await sleep(reducedMotion()?100:420);
  splash.remove();
}

export function restartAuthIntro(){
  const auth=byId('auth-view');
  if(auth)auth.dataset.ffMotionV5='';
  return playAuthIntro({force:true});
}

export function setLoginButtonMotion(busy,mode='login',phase='auth'){
  const btn=byId('auth-submit');
  if(!btn)return;
  document.documentElement.classList.toggle('ff-motion-login-busy',Boolean(busy));
  btn.classList.toggle('ff-motion-login-capsule',Boolean(busy));
  if(busy){
    btn.innerHTML='<span class="ff-motion-login-spinner" aria-hidden="true"></span>';
    btn.setAttribute('aria-label',phase==='data'?'Carregando seus dados':(mode==='register'?'Criando conta':'Entrando'));
  }else{
    btn.textContent=mode==='register'?'Criar conta':'Entrar';
    btn.setAttribute('aria-label',mode==='register'?'Criar conta':'Entrar');
  }
}

function ensureWipe(){
  let wipe=byId('ff-motion-wipe');
  if(!wipe){wipe=document.createElement('div');wipe.id='ff-motion-wipe';wipe.className='ff-motion-wipe';wipe.setAttribute('aria-hidden','true');document.body.appendChild(wipe)}
  return wipe;
}

export function snapshotDashboardMoney(){
  return MONEY_IDS.map(id=>{
    const el=byId(id);
    return el?{el,value:parseBRL(el.textContent)}:null;
  }).filter(Boolean);
}

export function resetDashboardMoney(targets){
  targets.forEach(({el})=>{el.classList.add('ff-motion-counting');el.textContent=moneyFormatter.format(0)});
}

export function animateDashboardMoney(targets,duration=2500){
  if(!targets?.length)return;
  if(reducedMotion())duration=320;
  const start=performance.now();
  const frame=now=>{
    const t=Math.min(1,(now-start)/duration);
    // Curva mais suave para o valor ser percebido durante todo o percurso.
    const eased=1-Math.pow(1-t,2.35);
    targets.forEach(({el,value})=>{el.textContent=moneyFormatter.format(value*eased)});
    if(t<1){requestAnimationFrame(frame);return}
    targets.forEach(({el,value})=>{el.textContent=moneyFormatter.format(value);el.classList.remove('ff-motion-counting')});
  };
  requestAnimationFrame(frame);
}

export function revealDashboard({moneyTargets,onCovered,onComplete}={}){
  const app=byId('app-view');
  const wipe=ensureWipe();
  resetDashboardMoney(moneyTargets||[]);

  if(reducedMotion()){
    onCovered?.();
    app?.classList.add('ff-motion-dashboard-in');
    animateDashboardMoney(moneyTargets||[],320);
    window.setTimeout(()=>app?.classList.remove('ff-motion-dashboard-in'),260);
    onComplete?.();
    return;
  }

  document.documentElement.classList.add('ff-motion-transition');
  wipe.classList.remove('is-running');void wipe.offsetWidth;wipe.classList.add('is-running');

  // O auth só some quando a camada já cobriu a tela.
  window.setTimeout(()=>onCovered?.(),620);
  window.setTimeout(()=>{
    wipe.classList.remove('is-running');
    document.documentElement.classList.remove('ff-motion-transition');
    app?.classList.add('ff-motion-dashboard-in');

    // Pequena pausa após o reveal deixa o count-up mais legível.
    window.setTimeout(()=>animateDashboardMoney(moneyTargets||[],2500),90);
    window.setTimeout(()=>app?.classList.remove('ff-motion-dashboard-in'),700);
    onComplete?.();
  },1360);
}
