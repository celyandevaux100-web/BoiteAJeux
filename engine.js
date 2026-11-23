/* The room host owns the round and sends each player only their own view. */
const Games = (() => {
  const catalog = {
    spectre: {title:"Le Spectre",family:"Intuition",min:2,pitch:"Un indice, deux extrêmes. Sauras-tu viser juste ?"},
    imposteur: {title:"L’Imposteur",family:"Bluff",min:3,pitch:"Un mot vous sépare. Démasque l’intrus avant la fin."},
    dixit: {title:"Mini Dixit",family:"Imagination",min:2,pitch:"Un indice mystérieux pour retrouver l’image du conteur."},
    cerveau: {title:"Même Cerveau",family:"Association",min:2,pitch:"Une question pour tous. Êtes-vous sur la même longueur d’onde ?"},
    secret: {title:"Top Secret",family:"Déduction",min:2,pitch:"Décrypte un exemple pour retrouver le nombre caché."}
  };
  const prompts = {
    spectre:[
      ["Un film que tu fuirais","Un film culte"],["Très discret","Impossible à rater"],["Sans saveur","Délicieux"],["Très calme","Assourdissant"],["Glacial","Brûlant"],["Très ordinaire","Extraordinaire"],["Tout simple","Très complexe"],["Ennuyeux","Passionnant"],["Éphémère","Éternel"],["Facile à porter","Très encombrant"]
    ],
    secret:[
      ["Dangerosité d’un personnage de fiction","Inoffensif","Extrêmement dangereux"],["Difficulté d’un sport","Accessible","Très technique"],["Vitesse d’un animal","Très lent","Très rapide"],["Piquant d’un plat","Très doux","Brûlant"],["Encombrement d’un objet à emporter","Minuscule","Gigantesque"],["Bruit d’un moyen de transport","Silencieux","Assourdissant"],["Rareté d’un trésor","Très commun","Unique"],["Fragilité d’un objet du quotidien","Incassable","Très fragile"]
    ],
    imposteur:[["Plage","Piscine"],["Train","Métro"],["Crêpe","Gaufre"],["Phare","Tour"],["Grotte","Tunnel"],["Forêt","Jungle"],["Cinéma","Théâtre"],["Miel","Caramel"],["Clarinette","Flûte"],["Piano","Orgue"],["Boussole","Carte"],["Raquette","Pagaie"]],
    cerveau:["Cite quelque chose qu’on trouve dans un frigo.","Quel animal aimerais-tu observer en safari ?","Qu’emporte-t-on à la plage ?","Cite un parfum de glace.","Quel objet perd-on tout le temps ?","Cite un aliment qui croustille.","Qu’est-ce qui brille dans le noir ?","Cite un jeu de cour de récréation.","Qu’ajouterais-tu sur une pizza ?","Cite un objet qu’on trouve dans une trousse.","Que fais-tu quand il pleut ?","Cite un objet qui flotte.","Qu’achète-t-on à la boulangerie ?","Cite une chose qu’on collectionne.","Quel fruit mettrais-tu dans un smoothie ?","Cite une odeur qui rappelle les vacances."]
  };
  const indices = n => Array.from({length:n},(_,i)=>i);
  const random = n => Math.floor(Math.random()*n);
  function shuffle(values) {
    const result = [...values];
    for(let i=result.length-1;i>0;i--) {const j=random(i+1); [result[i],result[j]]=[result[j],result[i]];}
    return result;
  }
  const norm = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("fr").trim().replace(/\s+/g," ");
  function check(test,message="Ce choix n’est plus disponible.") {if(!test) throw new Error(message);}
  function words(value,max=100) {
    check(typeof value==="string" && value.trim().length>0 && value.trim().length<=max,"Écris une réponse courte avant de valider.");
    return value.trim();
  }
  function create(game,names) {
    check(Object.hasOwn(catalog,game) && names.length>=catalog[game].min && names.length<=6,"Nombre de joueurs incompatible.");
    const all=indices(names.length);
    const s={game,names,all,scores:all.map(()=>0),round:0,total:game==="dixit"?names.length*2:game==="cerveau"?8:names.length,
      prompts:shuffle(prompts[game]||[]),hands:all.map(()=>[]),deck:shuffle(indices(60)),discard:[],stamp:0};
    advance(s);
    return s;
  }
  function draw(s) {
    if(!s.deck.length) {s.deck=shuffle(s.discard);s.discard=[];}
    return s.deck.pop();
  }
  function phase(s,name) {s.phase=name;s.stamp++;}
  function advance(s) {
    if(s.round && s.phase!=="result") return;
    if(s.round===s.total) {phase(s,"end");return;}
    if(s.game==="dixit" && s.round) {
      for(const [id,card] of Object.entries(s.picks)) {
        s.hands[id]=s.hands[id].filter(x=>x!==card);s.discard.push(card);
      }
      s.discard.push(...s.decoys);
    }
    s.lead=s.round%s.names.length;s.round++;
    Object.assign(s,{answers:{},picks:{},active:[...s.all],clues:[],clue:"",events:[],decoys:[],board:[],gain:s.all.map(()=>0),report:[],reveal:[]});
    s.prompt=s.prompts[s.round-1];
    if(s.game==="dixit") for(const hand of s.hands) while(hand.length<5) hand.push(draw(s));
    if(s.game==="imposteur") {s.spy=random(s.all.length);if(random(2))s.prompt=[...s.prompt].reverse();}
    if(["secret","spectre"].includes(s.game)) s.secret=random(101);
    phase(s,s.game==="cerveau"?"answer":s.game==="imposteur"?"hint":"clue");
  }
  function pending(s) {
    switch(s.phase) {
      case "clue":return [s.lead];
      case "hint":return [s.active[s.clues.length]];
      case "pick":return s.all.filter(i=>i!==s.lead && !(i in s.picks));
      case "answer":return s.all.filter(i=>(s.game==="cerveau" || i!==s.lead) && !(i in s.answers));
      case "vote":return s.active.filter(i=>(s.game!=="dixit" || i!==s.lead) && !(i in s.answers));
      default:return [];
    }
  }
  function finish(s) {
    s.gain.forEach((v,i)=>s.scores[i]+=v);
    phase(s,"result");
  }
  function scoreAnswers(s) {
    if(s.game==="cerveau") {
      const answers=s.all.map(i=>norm(s.answers[i]));
      s.all.forEach(i=>{
        const matches=answers.filter(a=>a===answers[i]).length-1;
        s.gain[i]=s.all.length===2?2*matches:matches;
        s.report.push([s.names[i],s.answers[i]]);
      });
    } else {
      s.reveal=["Nombre secret",String(s.secret)];
      s.all.filter(i=>i!==s.lead).forEach(i=>{
        const d=Math.abs(s.answers[i]-s.secret);
        s.gain[i]=d<=5?3:d<=15?2:d<=25?1:0;
        if(d<=15)s.gain[s.lead]=1;
        s.report.push([s.names[i],s.answers[i]+" · écart de "+d]);
      });
    }
    finish(s);
  }
  function mixBoard(s) {
    if(s.all.length===2) s.decoys=[draw(s),draw(s),draw(s)];
    s.board=shuffle([...Object.values(s.picks),...s.decoys]);phase(s,"vote");
  }
  function scoreImages(s) {
    const target=s.picks[s.lead];
    const votes=Object.values(s.answers);
    const hits=votes.filter(c=>c===target).length;
    for(const i of s.all) {
      if(s.all.length===2) s.gain[i]=hits*(i===s.lead?1:2);
      else if(i===s.lead) s.gain[i]=hits>0 && hits<votes.length?3:0;
      else {
        s.gain[i]=hits===0 || hits===votes.length?2:s.answers[i]===target?3:0;
        s.gain[i]+=votes.filter(c=>c===s.picks[i]).length;
      }
    }
    s.reveal=["Image du conteur","Carte "+(s.board.indexOf(target)+1)];
    s.board.forEach((c,k)=>{
      const owner=s.all.find(i=>s.picks[i]===c);
      const voters=s.all.filter(i=>s.answers[i]===c).map(i=>s.names[i]);
      s.report.push(["Carte "+(k+1)+" · "+(s.names[owner]||"Leurre"),voters.length?"Votes de "+voters.join(", "):"Aucun vote"]);
    });
    finish(s);
  }
  function eliminate(s) {
    const counts=s.active.map(i=>Object.values(s.answers).filter(v=>v===i).length);
    const tied=s.active.filter((_,j)=>counts[j]===Math.max(...counts));
    if(tied.length===1) {
      const id=tied[0];s.active=s.active.filter(i=>i!==id);
      s.events.push(s.names[id]+" est éliminé·e ("+(id===s.spy?"imposteur":"innocent")+").");
      if(id===s.spy || s.active.length===2) {
        const found=id===s.spy;
        s.reveal=[found?"Les innocents gagnent !":"L’imposteur gagne !",s.names[s.spy]+" était l’imposteur."];
        s.report=[["Mot commun",s.prompt[0]],["Mot de l’imposteur",s.prompt[1]]];
        s.gain=s.all.map(i=>found?(i===s.spy?0:2):(i===s.spy?4:0));
        finish(s);return;
      }
    } else s.events.push("Égalité au vote. Tout le monde reste en jeu.");
    s.clues=[];s.answers={};phase(s,"hint");
  }
  function submit(s,i,input,stamp) {
    check(stamp===s.stamp && pending(s).includes(i));
    switch(s.phase) {
      case "clue": {
        const clue=words(input.text);
        if(s.game==="dixit") {check(s.hands[i].includes(input.card),"Choisis une image.");s.picks[i]=input.card;}
        else if(s.game==="secret") check(!/[\d%]/.test(clue),"Donne un exemple sans chiffres ni pourcentage.");
        else {
          const numbers=clue.match(/\d+/g)||[];
          check(!numbers.some(n=>Number(n)===s.secret) && !/%|pour\s*cent|\d+\s*(?:[-–à]|et)\s*\d+/i.test(clue),"Garde le nombre secret et évite les fourchettes et pourcentages.");
        }
        s.clue=clue;
        if(s.game!=="dixit") phase(s,"answer");
        else if(s.all.length===2)mixBoard(s);
        else phase(s,"pick");
        break;
      }
      case "pick":check(s.hands[i].includes(input.card),"Choisis une image.");s.picks[i]=input.card;if(!pending(s).length)mixBoard(s);break;
      case "hint": {
        const clue=words(input.text,80);
        check(!norm(clue).includes(norm(s.prompt[i===s.spy?1:0])),"L’indice contient ton mot secret.");
        s.clues.push([i,clue]);if(s.clues.length===s.active.length)phase(s,"vote");break;
      }
      case "answer":
        if(s.game==="cerveau") s.answers[i]=words(input.text,60);
        else {check(Number.isInteger(input.value)&&input.value>=0&&input.value<=100);s.answers[i]=input.value;}
        if(!pending(s).length)scoreAnswers(s);break;
      case "vote":
        if(s.game==="dixit") check(s.board.includes(input.value)&&input.value!==s.picks[i],"Choisis une image autre que la tienne.");
        else check(s.active.includes(input.value)&&input.value!==i,"Choisis un autre joueur.");
        s.answers[i]=input.value;
        if(!pending(s).length) {if(s.game==="dixit")scoreImages(s);else eliminate(s);}
        break;
    }
  }
  function view(s,i) {
    const {game,names,scores,round,total,phase,stamp,lead,clue,clues,events,board,active}=s;
    const todo=pending(s);
    const v={game,names,scores,round,total,phase,stamp,lead,clue,clues,events,board,active,todo,i};
    if(game!=="imposteur")v.prompt=s.prompt;
    if(game==="imposteur" && active.includes(i))v.word=s.prompt[i===s.spy?1:0];
    if(i===lead && phase==="clue")v.secret=s.secret;
    if(game==="dixit") {v.hand=s.hands[i]||[];v.own=s.picks[i];}
    if(phase==="result" || phase==="end") Object.assign(v,{gain:s.gain,report:s.report,reveal:s.reveal});
    return v;
  }
  return {catalog,create,advance,view,submit,pending,norm};
})();
if(typeof module!=="undefined") module.exports=Games;
