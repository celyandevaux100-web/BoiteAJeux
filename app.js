"use strict";
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const icon = name => ICONS[name] || "";
const catalog=Games.catalog;
const dialog=$("#dialog"), body=$("#dialogBody"), table=$("#table");
let room=null, screen=null, peer=null, link=null, identity=null, timer=null, toastTimer=null, gate=false;
const clients=new Map();
const storageKey="boitajeux-session-v1";
const codeAlphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const roomPrefix="boiteajeux-fr-v1-";
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,"0")).join("");
const newCode=()=>Array.from(crypto.getRandomValues(new Uint8Array(6)),v=>codeAlphabet[v%32]).join("");
const gameOptions=selected=>Object.entries(catalog).map(([k,g])=>'<option value="'+k+'" '+(k===selected?'selected':'')+'>'+g.title+' · '+g.min+' à 6 joueurs</option>').join("");
const savedName=()=>{try{return localStorage.getItem("boitajeux-name")||"";}catch{return "";}};
function save() {try{sessionStorage.setItem(storageKey,JSON.stringify({room,identity}));}catch{}}
function toast(msg){clearTimeout(toastTimer);$("#announcer").textContent=msg;toastTimer=setTimeout(()=>$("#announcer").textContent="",4300);}
function openDialog(html,title) {body.innerHTML=html;dialog.setAttribute("aria-label",title);if(!dialog.open)dialog.showModal();}
function showRules(k){
  const g=catalog[k];
  openDialog('<div class="rulehead"><img src="assets/'+k+'.webp" alt=""><div><small>'+g.family+'</small><h2>'+g.title+'</h2></div></div><p>'+g.pitch+'</p><p class="pill">'+g.min+' à 6 joueurs</p><details class="ruledetails" open><summary>Règles du jeu</summary><div class="rules">'+esc(RULES[k].trim())+'</div></details>'+(!screen?'<button class="primary" data-choose="'+k+'">'+icon("plus")+'Créer un salon</button>':''),g.title);
}
function formError(msg){const slot=body.querySelector(".formerror")||table.querySelector(".formerror");if(slot)slot.textContent=msg;else toast(msg);}
function nameField(label,value="",name="name"){return '<label class="field"><span>'+label+'</span><input name="'+name+'" maxlength="20" autocomplete="off" required placeholder="Ton pseudo" value="'+esc(value)+'"></label>';}
function openSetup(kind="create",selected="spectre",code="",mode="online"){
  const join=kind==="join";
  openDialog('<h2>'+(join?"Rejoindre un salon":"Créer un salon")+'</h2><p>'+(join?"Entre le code partagé par ton pote.":"Choisis comment vous allez jouer.")+'</p><form id="setup">'+(!join?'<div class="seg"><button type="button" data-mode="online" class="'+(mode==="online"?'on':'')+'">'+icon("wifi")+' En ligne</button><button type="button" data-mode="local" class="'+(mode==="local"?'on':'')+'">'+icon("smartphone")+' Sur un appareil</button></div>':'')+
    (join?'<label class="field"><span>Code du salon</span><input class="codeinput" name="code" required minlength="6" maxlength="6" autocomplete="off" placeholder="ABC123" value="'+esc(code)+'"></label>':'<label class="field"><span>Jeu</span><select name="game">'+gameOptions(selected)+'</select></label>')+
    (mode==="local"?'<label class="field"><span>Nombre de joueurs</span><select name="count">'+[2,3,4,5,6].map(n=>'<option '+(n<catalog[selected].min?'disabled':'')+' '+(n===catalog[selected].min?'selected':'')+'>'+n+'</option>').join("")+'</select></label><div class="listfields" id="names"></div>':nameField("Ton pseudo",savedName()))+
    '<span class="formerror" role="alert"></span><button class="primary" type="submit">'+icon(join?"ticket":"plus")+(join?"Rejoindre le salon":"Créer le salon")+'</button></form>',join?"Rejoindre un salon":"Créer un salon");
  const f=$("#setup");
  function localNames(){const old=[...f.querySelectorAll('[name="member"]')].map(e=>e.value);const min=catalog[f.game.value].min;
    for(const opt of f.count.options)opt.disabled=Number(opt.value)<min;
    if(+f.count.value<min)f.count.value=min;
    $("#names").innerHTML=Array.from({length:+f.count.value},(_,i)=>nameField("Joueur "+(i+1),old[i]??(i===0?savedName():""),"member")).join("");
  }
  if(mode==="local"){localNames();f.count.onchange=localNames;f.game.onchange=localNames;}
  f.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>openSetup(kind,f.game.value,code,b.dataset.mode));
  f.onsubmit=e=>{
    e.preventDefault();
    const names=mode==="local"?[...f.querySelectorAll('[name="member"]')].map(x=>x.value.trim()):[f.elements.namedItem("name").value.trim()];
    if(names.some(n=>!n)||new Set(names.map(Games.norm)).size!==names.length){formError("Choisissez des pseudos différents et non vides.");return;}
    try{localStorage.setItem("boitajeux-name",names[0]);}catch{}
    if(join) {
      const entered=f.code.value.trim().toUpperCase();
      if(!/^[A-Z2-9]{6}$/.test(entered)){formError("Le code contient 6 lettres ou chiffres, sans 0 ni 1.");return;}
      joinRoom(entered,names[0]);return;
    }
    createRoom(mode,f.game.value,names);
  };
}
function waitDialog(title,message) {openDialog('<h2>'+title+'</h2><p role="status">'+message+'</p><button class="ghostbtn" data-cancel>Annuler</button>',title);}
function stopNetwork(){clearTimeout(timer);const old=peer;peer=null;link=null;clients.clear();if(old)old.destroy();}
function cleanSession(){stopNetwork();room=null;screen=null;identity=null;gate=false;try{sessionStorage.removeItem(storageKey);}catch{}}
function landing(){
  cleanSession();dialog.close();table.hidden=true;$("#home").hidden=false;document.body.classList.remove("playing");table.innerHTML="";history.replaceState(null,"",location.pathname+location.search);window.scrollTo(0,0);
}
function failure(message) {
  const guest=identity?.role==="guest";const code=identity?.code;const name=identity?.name;const key=identity?.key;const selected=room?.selected||"spectre";const host=identity?.role==="host" && room && room.mode==="online";
  stopNetwork();
  openDialog('<h2>Connexion interrompue</h2><p role="alert">'+esc(message)+'</p><div class="actions"><button class="primary" id="retry">Réessayer</button><button class="white" id="backhome">Accueil</button></div>',"Connexion interrompue");
  $("#retry").onclick=()=>{if(guest)joinRoom(code,name,key);else if(host)hostOnline();else openSetup("create",selected);};
  $("#backhome").onclick=landing;
}
function createRoom(mode,selected,names) {
  stopNetwork();
  room={mode,selected,code:mode==="local"?"":newCode(),players:names.map(name=>({name,key:token(),online:true})),state:null};
  identity={role:"host",code:room.code,name:names[0]};gate=false;
  if(mode==="online") hostOnline();else {dialog.close();publish();}
}
function startPeer(id,onOpen){
  if(typeof RoomPeer==="undefined"){failure("Le module de connexion n’a pas pu démarrer.");return null;}
  const p=new RoomPeer(id);peer=p;
  timer=setTimeout(()=>{if(p===peer)failure("Le salon ne répond pas. Vérifie le code, ta connexion et que l’hôte a gardé son onglet ouvert.");},18000);
  p.on("open",()=>{if(p===peer)onOpen(p);});
  p.on("error",e=>{
    if(p!==peer)return;
    if(room && e.type==="unavailable-id" && !screen && room.players.length===1 && !room.state){room.code=newCode();identity.code=room.code;hostOnline();return;}
    if(room && screen && e.type==="peer-unavailable")return;
    failure(e.type==="peer-unavailable"?"Salon introuvable. Vérifie le code et que ton pote est encore dans le salon.":"La connexion au salon a échoué. Vérifie ton accès Internet, puis réessaie.");
  });
  p.on("disconnected",()=>{if(p===peer && !p.destroyed){try{p.reconnect();}catch{}}});
  return p;
}
function hostOnline(){
  stopNetwork();room.players.forEach((m,i)=>m.online=i===0);waitDialog("Ouverture du salon","Connexion au service de jeu en ligne…");
  const p=startPeer(roomPrefix+room.code,()=>{clearTimeout(timer);dialog.close();publish();});
  p?.on("connection",c=>{
    let seat=null;
    function reject(msg){c.send({kind:"error",message:msg});setTimeout(()=>c.close(),250);}
    c.on("data",data=>{
      if(p!==peer||!room||!data||typeof data!=="object")return;
      if(seat===null) {
        if(data.kind!=="hello"||typeof data.key!=="string"||!(/^[a-f0-9]{32}$/).test(data.key))return reject("Invitation invalide.");
        seat=room.players.find(m=>m.key===data.key);
        if(seat===room.players[0]){seat=null;return reject("Cette place est réservée.");}
        if(!seat) {
          if(room.state||room.players.length>=6)return reject(room.state?"Une partie est déjà en cours.":"Le salon est complet.");
          const name=String(data.name||"").trim().slice(0,20);
          if(!name||room.players.some(m=>Games.norm(m.name)===Games.norm(name)))return reject("Ce pseudo est déjà pris ou vide.");
          seat={name,key:data.key,online:true};room.players.push(seat);
        }
        const old=clients.get(seat.key);clients.set(seat.key,c);if(old&&old!==c)old.close();seat.online=true;publish();return;
      }
      if(clients.get(seat.key)!==c)return;
      if(data.kind==="leave"){c.close();return;}
      if(data.kind==="action" && room.state) {
        try{Games.submit(room.state,room.players.indexOf(seat),data.input,data.stamp);publish();}
        catch(err){c.send({kind:"notice",message:err.message});}
      }
    });
    c.on("close",()=>{if(p!==peer||!room||!seat||clients.get(seat.key)!==c)return;
      clients.delete(seat.key);seat.online=false;if(!room.state)room.players=room.players.filter(m=>m!==seat);publish();
    });
  });
}
function joinRoom(code,name,key=token()){
  stopNetwork();room=null;identity={role:"guest",name,code,key};waitDialog("Connexion au salon","Recherche du salon "+esc(code)+"…");
  startPeer(undefined,p=>{
    const c=p.connect(roomPrefix+code,{reliable:true});link=c;
    c.on("open",()=>c.send({kind:"hello",name,key}));
    c.on("data",packet=>{
      if(peer!==p||!packet)return;
      if(packet.kind==="view"){clearTimeout(timer);const wasWaiting=!screen||body.querySelector("[data-cancel]");if(wasWaiting)dialog.close();save();display(packet.screen);}
      else if(packet.kind==="notice")toast(packet.message);
      else if(packet.kind==="error")failure(packet.message);
      else if(packet.kind==="closed"){landing();toast("L’hôte a fermé le salon.");}
    });
    c.on("close",()=>{if(p===peer)failure("Le lien avec l’hôte a été coupé. Tu peux reprendre ta place avec cet onglet.");});
  });
}
function snapshot(index){
  const s=room.state;
  return {code:room.code,selected:room.selected,mode:room.mode,host:index===0,
    people:room.players.map(({name,online})=>({name,online})),game:s?Games.view(s,index):null};
}
function publish(){
  save();
  room.players.forEach((m,i)=>{const c=clients.get(m.key);if(c?.open)c.send({kind:"view",screen:snapshot(i)});});
  let s=snapshot(0);
  if(room.mode==="local" && room.state && Games.pending(room.state).length) {
    s.game=Games.view(room.state,Games.pending(room.state)[0]);
  }
  display(s);
}
function action(input){
  if(!screen?.game)return;
  if(room){Games.submit(room.state,screen.game.i,input,screen.game.stamp);gate=false;publish();}
  else if(link?.open)link.send({kind:"action",input,stamp:screen.game.stamp});
  else failure("La connexion a été interrompue.");
}
function display(s){
  // Keep unsubmitted input when another player locks in an answer in the same phase.
  const keep=screen?.game && s.game && screen.mode==="online" && screen.game.stamp===s.game.stamp && s.game.todo.includes(s.game.i) && screen.game.todo.includes(s.game.i) && $("#gameform");
  const draft=keep?Object.fromEntries(new FormData(keep)):null;
  const focus=keep?.contains?.(document.activeElement)?document.activeElement.name:null;
  if(!screen||!!screen.game!==!!s.game||screen.game?.stamp!==s.game?.stamp)window.scrollTo(0,0);
  screen=s;document.body.classList.add("playing");$("#home").hidden=true;table.hidden=false;
  const k=s.selected;const local=s.mode==="local";
  const tools='<div class="tablebar"><div><span class="pill">'+(local?"Sur un appareil":"Salon "+esc(s.code))+'</span></div><div><button class="ghostbtn" data-rules="'+k+'">'+icon("book-open")+'Règles</button><button class="ghostbtn" data-leave>'+icon("log-out")+'Quitter</button></div></div>';
  if(!s.game){table.innerHTML=tools+lobby(s);return;}
  const g=s.game;
  const disconnected=s.people.filter(m=>!m.online).map(m=>esc(m.name));
  const status=disconnected.length?'<div class="notice">En attente de reconnexion · '+disconnected.join(", ")+(s.host?' <button class="smallbtn" data-reset>Revenir au salon</button>':'')+'</div>':'';
  let content;
  if(g.phase==="result"||g.phase==="end")content=results(g,s.host);
  else if(local&&!gate)content='<div class="center"><div class="waiticon">'+icon("lock-keyhole")+'</div><h2>Passe l’écran à '+esc(g.names[g.i])+'</h2><p>Les autres joueurs détournent le regard.</p><button class="primary" id="unlock">C’est moi, afficher mon tour</button></div>';
  else content=turn(g);
  table.innerHTML=tools+status+'<section class="panel"><p class="tag">'+catalog[k].title+' · Manche '+g.round+' sur '+g.total+'</p>'+content+'</section>';
  const f=$("#gameform");
  if(draft&&f){
    for(const [key,value] of Object.entries(draft)){
      const input=f.elements.namedItem(key);if(input)input.value=value;
    }
    if(focus)f.querySelector('[name="'+CSS.escape(focus)+'"]')?.focus();
  }
  if(f) {
    const range=f.querySelector('[type="range"]');if(range){const update=()=>f.querySelector("output").textContent=range.value;range.oninput=update;update();}
    f.onsubmit=e=>{e.preventDefault();const d=new FormData(f);const input={text:d.get("text"),card:d.has("card")?Number(d.get("card")):null,value:d.has("value")?Number(d.get("value")):null};
      try{action(input);}catch(err){formError(err.message);}
    };
  }
}
function lobby(s){
  const k=s.selected,g=catalog[k],online=s.mode==="online";const count=s.people.filter(m=>m.online).length;
  return '<div class="roomgrid"><section class="panel"><h2>Ton salon</h2>'+(online?'<p>Invite tes potes avec ce code.</p><div class="roomcode">'+esc(s.code)+'</div><div class="actions"><button class="soft" data-copy="link">'+icon("link")+'Copier le lien</button><button class="ghostbtn" data-copy="code">'+icon("copy")+'Copier le code</button></div>':'<p>Passez l’appareil à chaque tour pour garder vos choix secrets.</p>')+
    '<div class="roomgame"><img src="assets/'+k+'.webp" alt=""><div><strong>'+g.title+'</strong><br><small>'+g.min+' à 6 joueurs</small></div></div>'+
    (s.host?'<label class="field"><span>Jeu de la partie</span><select id="lobbyGame">'+gameOptions(k)+'</select></label><p class="muted">'+(count<g.min?'Il manque '+(g.min-count)+' joueur(s) pour commencer.':"Tout le monde est là ?")+'</p><button class="primary" data-start '+(count<g.min?'disabled':'')+'>'+icon("play")+'Lancer la partie</button>':'<p class="muted">L’hôte lancera la partie.</p>')+'</section><section class="panel"><h2>Les joueurs</h2><span class="pill">'+count+' / 6</span><ul class="people">'+s.people.map((p,i)=>'<li><b class="avatar" style="--h:'+((i*64+315)%360)+'">'+esc(p.name.slice(0,1).toUpperCase())+'</b>'+esc(p.name)+'<small>'+(i===0?"Hôte":p.online?"Prêt·e":"Déconnecté·e")+'</small></li>').join("")+'</ul>'+(online&&s.host?'<p class="muted">Garde cet onglet ouvert pendant la partie.</p>':'')+'</section></div>';
}
function pictureBoard(cards,field,forbidden){
  return '<div class="board">'+cards.map((id,j)=>'<label class="artcard"><img src="assets/dreams/'+id+'.webp" alt="'+esc(LABELS[id])+'"><input type="radio" name="'+field+'" value="'+id+'" '+(forbidden===id?'disabled':'required')+'>'+(forbidden===id?'Ta carte':'Carte '+(j+1))+'</label>').join("")+'</div>';
}
function turn(g) {
  const me=g.i,doing=g.todo.includes(me),lead=esc(g.names[g.lead]);
  let intro="",input="",title="";
  if(g.game==="imposteur"){
    if(g.events.length)intro+='<p class="notice">'+g.events.map(esc).join("<br>")+'</p>';
    if(g.word)intro+='<div class="cluebox">Ton mot secret · '+esc(g.word)+'</div>';
    if(g.clues.length)intro+='<h3>Les indices</h3><ul class="report">'+g.clues.map(([i,t])=>'<li><b>'+esc(g.names[i])+'</b><span>'+esc(t)+'</span></li>').join("")+'</ul>';
  }
  if(g.game==="spectre"||g.game==="secret"){
    const p=g.prompt;
    intro+='<div class="cluebox">'+(p.length===3?'<b>'+esc(p[0])+'</b>':'')+'<div class="ends"><span>0 · '+esc(p.at(-2))+'</span><span>100 · '+esc(p.at(-1))+'</span></div></div>';
  }
  if(g.clue) intro+='<div class="cluebox">Indice de '+lead+'<br><strong>« '+esc(g.clue)+' »</strong></div>';
  if(!doing) {
    const waiting=g.todo.map(i=>esc(g.names[i])).join(", ");
    return '<h2>'+(g.game==="imposteur"&&!g.active.includes(me)?"Tu observes la manche":"À vos partenaires de jouer")+'</h2>'+intro+'<p class="muted" role="status">'+icon("hourglass")+' En attente de '+waiting+'.</p>';
  }
  const text=(label,placeholder,max=100)=>'<label class="field"><span>'+label+'</span><input name="text" required maxlength="'+max+'" autocomplete="off" placeholder="'+placeholder+'"></label>';
  switch(g.phase){
    case "clue":
      if(g.game==="dixit"){title="À toi de raconter";input=pictureBoard(g.hand,"card")+text("Ton indice imaginatif","Un mot, une phrase…");}
      else {title=g.game==="secret"?"À toi, maître du nombre":"À toi de donner un indice";intro+='<div class="revealbox">Ton nombre secret<strong>'+g.secret+'</strong></div>';input=text(g.game==="secret"?"Donne un exemple concret du thème":"Ton indice",g.game==="secret"?"Sans chiffre ni pourcentage":"Sans révéler le nombre secret");}
      break;
    case "hint":title="Donne un indice";input=text("Évoque ton mot sans le prononcer","Un indice court…",80);break;
    case "pick":title="Choisis une image pour cet indice";input=pictureBoard(g.hand,"card");break;
    case "answer":
      if(g.game==="cerveau"){title=esc(g.prompt);input=text("Ta réponse secrète","Une seule réponse…",60);}
      else {title="Où placerais-tu cet indice ?";input='<label class="rangebox"><span>Ton estimation</span><output>50</output><input aria-label="Ton estimation" name="value" type="range" min="0" max="100" value="50"><span class="ends"><span>0</span><span>100</span></span></label>';}
      break;
    case "vote":
      if(g.game==="dixit"){title="Quelle est l’image du conteur ?";input=pictureBoard(g.board,"value",g.own);}
      else {title="Qui est l’imposteur ?";input='<div class="options">'+g.active.filter(i=>i!==me).map(i=>'<label class="option"><input type="radio" name="value" value="'+i+'" required> '+esc(g.names[i])+'</label>').join("")+'</div>';}
      break;
  }
  return '<h2>'+title+'</h2>'+intro+'<form class="gameform" id="gameform">'+input+'<span class="formerror" role="alert"></span><button class="primary">'+icon("check")+'Valider mon choix</button></form>';
}
function results(g,host){
  const end=g.phase==="end",order=g.names.map((_,i)=>i).sort((a,b)=>g.scores[b]-g.scores[a]);
  const winners=order.filter(i=>g.scores[i]===g.scores[order[0]]).map(i=>esc(g.names[i]));
  return '<h2>'+(end?"Classement final":"Résultats de la manche")+'</h2>'+
    (end?'<div class="revealbox">'+icon("trophy")+' '+(winners.length>1?"Victoire ex æquo":"Victoire")+'<strong>'+winners.join(" & ")+'</strong></div>':(g.reveal.length?'<div class="revealbox">'+esc(g.reveal[0])+'<strong>'+esc(g.reveal[1])+'</strong></div>':'')+
      (g.game==="dixit"?'<div class="board">'+g.board.map((v,j)=>'<div class="artcard"><img alt="'+esc(LABELS[v])+'" src="assets/dreams/'+v+'.webp">Carte '+(j+1)+'</div>').join("")+'</div>':'')+
      '<ul class="report">'+g.report.map(([a,b])=>'<li><span>'+esc(a)+'</span><span>'+esc(b)+'</span></li>').join("")+'</ul><h3>Les scores</h3>')+
    '<ol class="rank">'+order.map(i=>'<li><b class="avatar" style="--h:'+((i*64+315)%360)+'">'+esc(g.names[i].slice(0,1))+'</b>'+esc(g.names[i])+'<strong>'+(!end?'+'+g.gain[i]+' · ':'')+g.scores[i]+' pts</strong></li>').join("")+'</ol>'+
    (host?'<button class="primary" '+(end?'data-lobby':'data-next')+'>'+icon(end?"door-open":"play")+(end?"Retour au salon":g.round===g.total?"Voir le classement":"Manche suivante")+'</button>':'<p class="muted">L’hôte prépare la suite.</p>');
}
function backToLobby(){room.state=null;room.players=room.players.filter(p=>p.online);gate=false;publish();}
document.addEventListener("change",e=>{if(e.target.id==="lobbyGame"&&room){room.selected=e.target.value;publish();}});
document.addEventListener("click",async e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.classList.contains("close")){if((!screen&&identity)||$("#backhome"))landing();else dialog.close();return;}
  const d=b.dataset;
  if(d.open)openSetup(d.open);
  else if(d.rules)showRules(d.rules);
  else if(d.choose)openSetup("create",d.choose);
  else if("cancel" in d)landing();
  else if("start" in d&&room){room.state=Games.create(room.selected,room.players.map(m=>m.name));gate=false;publish();}
  else if(b.id==="unlock"){gate=true;display(screen);}
  else if("next" in d&&room){Games.advance(room.state);gate=false;publish();}
  else if("lobby" in d&&room)backToLobby();
  else if("reset" in d)openDialog('<h2>Arrêter cette partie ?</h2><p>Les joueurs connectés retourneront au salon. Les scores de la partie seront effacés.</p><button class="primary" id="resetOK">Retour au salon</button>',"Arrêter la partie");
  else if(b.id==="resetOK"){dialog.close();backToLobby();}
  else if(d.copy){const url=new URL(location.href);url.hash="salon="+screen.code;const val=d.copy==="code"?screen.code:url.href;
    try{await navigator.clipboard.writeText(val);toast(d.copy==="code"?"Code copié !":"Lien d’invitation copié !");}catch{openDialog('<h2>Invitation</h2><label class="field"><span>À copier et partager</span><input readonly value="'+esc(val)+'"></label>',"Invitation");}}
  else if("leave" in d)openDialog('<h2>Quitter le salon ?</h2><p>'+(screen.host?"Quitter fermera ce salon et terminera la partie.":"Tu vas quitter la partie en cours.")+'</p><div class="actions"><button class="primary" data-confirmleave>Quitter</button><button class="white" data-stay>Rester</button></div>',"Quitter le salon");
  else if("stay" in d)dialog.close();
  else if("confirmleave" in d){if(room){for(const c of clients.values())if(c.open)c.send({kind:"closed"});}else if(link?.open)link.send({kind:"leave"});landing();}
});
dialog.addEventListener("cancel",()=>{if((!screen&&identity)||$("#backhome"))landing();});
document.querySelectorAll("[data-icon]").forEach(el=>el.innerHTML=icon(el.dataset.icon));
$("#cards").innerHTML=Object.entries(catalog).map(([k,g])=>'<button class="gamecard '+k+'" data-rules="'+k+'" aria-label="'+g.title+' · Voir les règles"><span class="category">'+g.family+'</span><img src="assets/'+k+'.webp" alt=""><span class="cardname">'+g.title+'</span><span class="cardfoot">'+icon("users")+g.min+' à 6 joueurs</span></button>').join("");
function init(){
  const code=new URLSearchParams(location.hash.slice(1)).get("salon")?.toUpperCase();
  let saved;try{saved=JSON.parse(sessionStorage.getItem(storageKey));}catch{}
  if(saved?.identity&&(!code||saved.identity.code===code)){
    identity=saved.identity;room=saved.room;
    if(room?.mode==="local"){publish();return;}
    if(identity.role==="host"&&room){hostOnline();return;}
    if(identity.role==="guest"){joinRoom(identity.code,identity.name,identity.key);return;}
  }
  if(code)openSetup("join","spectre",code);
}
init();
