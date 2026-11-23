/* WebRTC is preferred. An encrypted MQTT link handles pairs unable to open a data channel.
   The broker routes temporary messages. Game state is kept in the host tab. */
class Signals {
  constructor(){this.listeners=new Map();}
  on(name,fn){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(fn);}
  emit(name,...args){for(const fn of this.listeners.get(name)||[])fn(...args);}
}
const wireRoot="boiteajeux-fr/rooms/v1/";
const randomId=()=>crypto.randomUUID().replaceAll("-","");
const bytes64=buf=>btoa(String.fromCharCode(...new Uint8Array(buf)));
const from64=str=>Uint8Array.from(atob(str),c=>c.charCodeAt(0));
class RelayLink extends Signals {
  constructor(relay,remote){
    super();this.relay=relay;this.remote=remote;this.open=false;this.closed=false;
    this.out=Promise.resolve();this.in=Promise.resolve();this.last=Date.now();
    this.keys=crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},false,["deriveKey"]);
    this.localPub=this.keys.then(keys=>crypto.subtle.exportKey("jwk",keys.publicKey));
  }
  async establish(pub){
    const remoteKey=await crypto.subtle.importKey("jwk",pub,{name:"ECDH",namedCurve:"P-256"},false,[]);
    this.shared=await crypto.subtle.deriveKey({name:"ECDH",public:remoteKey},(await this.keys).privateKey,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
  }
  activate(){if(this.closed||this.open)return;this.open=true;this.emit("open");}
  send(data){this.sendPacket({type:"data",data});}
  sendPacket(packet){
    if(!this.open)return;
    this.out=this.out.then(async()=>{
      const iv=crypto.getRandomValues(new Uint8Array(12));
      const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},this.shared,new TextEncoder().encode(JSON.stringify(packet)));
      this.relay.publish(this.remote,{type:"box",from:this.relay.id,iv:bytes64(iv),payload:bytes64(encrypted)});
    }).catch(()=>this.close(false));
  }
  receive(packet){
    this.in=this.in.then(async()=>{
      if(!this.shared||this.closed)return;
      const bytes=await crypto.subtle.decrypt({name:"AES-GCM",iv:from64(packet.iv)},this.shared,from64(packet.payload));
      const msg=JSON.parse(new TextDecoder().decode(bytes));this.last=Date.now();
      if(msg.type==="data")this.emit("data",msg.data);
      if(msg.type==="bye")this.close(false);
    }).catch(()=>{ /* Ignore unrelated or invalid packets on a public broker. */ });
  }
  close(notify=true){if(this.closed)return;if(notify)this.sendPacket({type:"bye"});this.closed=true;this.open=false;this.relay.links.delete(this.remote);this.emit("close");}
}
class RoomRelay extends Signals {
  constructor(host){
    super();this.id=randomId();this.host=host;this.links=new Map();this.ready=false;this.closed=false;
    this.mqtt=new Paho.Client("wss://broker.emqx.io:8084/mqtt","baj-"+this.id.slice(0,18));
    this.mqtt.onMessageArrived=m=>this.receive(m).catch(()=>{});
    this.mqtt.onConnectionLost=()=>{this.ready=false;for(const c of this.links.values())c.close(false);};
    this.mqtt.onConnected=()=>this.subscribe();
    this.mqtt.connect({useSSL:true,timeout:8,keepAliveInterval:25,cleanSession:true,reconnect:true,onFailure:()=>{}});
    this.heartbeat=setInterval(()=>{for(const c of this.links.values()){
      if(Date.now()-c.last>90000)c.close(false);else c.sendPacket({type:"ping"});
    }},12000);
  }
  subscribe(){
    if(this.closed)return;
    const routes=[this.id];if(this.host)routes.push(this.host);
    let remaining=routes.length;
    for(const id of routes)this.mqtt.subscribe(wireRoot+id,{qos:1,onSuccess:()=>{
      if(--remaining===0&&!this.closed){this.ready=true;this.emit("ready");}
    }});
  }
  publish(id,packet){if(!this.ready)return;const m=new Paho.Message(JSON.stringify(packet));m.destinationName=wireRoot+id;m.qos=1;this.mqtt.send(m);}
  dial(host){
    const c=new RelayLink(this,host);
    const offer=async()=>{if(c.closed||c.open||!this.ready)return;this.publish(host,{type:"offer",from:this.id,pub:await c.localPub});};
    const retry=setInterval(offer,2300);c.on("open",()=>clearInterval(retry));c.on("close",()=>clearInterval(retry));
    this.dialing=c;offer();return c;
  }
  async receive(m){
    if(this.closed||m.payloadString.length>65000)return;
    const p=JSON.parse(m.payloadString);
    if(!p||typeof p.from!=="string"||!/^[a-f0-9]{32}$/.test(p.from))return;
    const dest=m.destinationName.slice(wireRoot.length);
    if(p.type==="offer"&&this.host&&dest===this.host){
      let c=this.links.get(p.from);
      if(!c){
        if(this.links.size>=20)return;
        c=new RelayLink(this,p.from);this.links.set(p.from,c);
        try{await c.establish(p.pub);}catch{c.close(false);return;}
        this.emit("connection",c);c.activate();
      }
      if(c.shared)this.publish(p.from,{type:"accept",from:this.id,room:this.host,pub:await c.localPub});
    }else if(p.type==="accept"&&dest===this.id && this.dialing && !this.dialing.open && !this.dialing.closed && p.room===this.dialing.remote){
      const c=this.dialing;
      await c.establish(p.pub);c.remote=p.from;this.links.set(p.from,c);c.activate();
    }else if(p.type==="box"&&dest===this.id)this.links.get(p.from)?.receive(p);
  }
  destroy(){this.closed=true;clearInterval(this.heartbeat);this.dialing?.close();for(const c of this.links.values())c.close();if(this.mqtt.isConnected())this.mqtt.disconnect();this.ready=false;}
}
class RoomPeer extends Signals {
  constructor(id){
    super();this.destroyed=false;this.opened=false;this.directReady=false;
    const opened=()=>{if(this.opened||this.destroyed)return;this.opened=true;this.emit("open");};
    try{
      this.direct=new Peer(id,{secure:true,debug:0});
      this.direct.on("open",()=>{this.directReady=true;opened();this.emit("direct-ready");});
      this.direct.on("connection",c=>this.emit("connection",c));
      this.direct.on("disconnected",()=>{this.directReady=false;if(!this.destroyed){try{this.direct.reconnect();}catch{}}});
      this.direct.on("error",e=>{if(e.type==="unavailable-id")this.emit("error",e);});
    }catch{}
    try{
      this.relay=new RoomRelay(id);
      this.relay.on("connection",c=>this.emit("connection",c));
      this.relay.on("ready",()=>{opened();this.emit("relay-ready");});
    }catch{}
  }
  connect(id){
    const out=new Signals();out.open=false;
    let chosen=null,rtc=null,fallback=null,closed=false;
    const attach=c=>{
      c.on("open",()=>{
        if(closed||chosen){c.close();return;}
        chosen=c;out.open=true;clearTimeout(delay);
        out.emit("open");
        if(rtc&&rtc!==chosen)rtc.close();if(fallback&&fallback!==chosen)fallback.close();
      });
      c.on("data",msg=>{if(chosen===c)out.emit("data",msg);});
      c.on("close",()=>{if(chosen===c){out.open=false;out.emit("close");}});
    };
    const tryDirect=()=>{if(!closed&&!chosen&&!rtc&&this.directReady){rtc=this.direct.connect(id,{reliable:true});attach(rtc);}};
    const tryRelay=()=>{if(!closed&&!chosen&&!fallback&&this.relay?.ready){fallback=this.relay.dial(id);attach(fallback);}};
    const delay=setTimeout(tryRelay,2400);
    this.on("direct-ready",tryDirect);this.on("relay-ready",()=>{if(!rtc)tryRelay();else if(!chosen)setTimeout(tryRelay,2400);});
    tryDirect();if(!rtc)tryRelay();
    out.send=m=>chosen?.send(m);
    out.close=()=>{closed=true;clearTimeout(delay);rtc?.close();fallback?.close();};
    this.outgoing=out;return out;
  }
  destroy(){this.destroyed=true;this.outgoing?.close();this.relay?.destroy();this.direct?.destroy();}
}
