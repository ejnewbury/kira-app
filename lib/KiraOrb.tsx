/**
 * KiraOrb — Full-screen voice call visualization.
 *
 * A glowing teal orb with fluid waveforms passing through it horizontally.
 * Waves are clipped to only appear outside the orb boundary, with a subtle
 * inner glow line visible inside. The orb breathes and pulses based on
 * voice state.
 *
 * Color identity (Kira's choice):
 * - Idle:      deep sea teal (#1A6B6B)
 * - Listening:  brightening teal (#2A9D8F)
 * - Speaking:   electric cyan (#00E5CC) with white core
 * - Thinking:   muted blue-violet (#6B7DB3)
 *
 * Uses react-native-canvas via WebView for high-performance rendering.
 */

import React, { useRef, useEffect } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import { WebView } from "react-native-webview";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export type OrbState = "idle" | "listening" | "speechDetected" | "playing" | "thinking";

interface KiraOrbProps {
  state: OrbState;
  audioLevel?: number; // 0-1 normalized audio amplitude
}

function getCanvasHTML(): string {
  return `<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>*{margin:0;padding:0}body{background:#0A0A0F;overflow:hidden}canvas{display:block}</style>
</head><body><canvas id="c"></canvas>
<script>
const canvas=document.getElementById('c');
const ctx=canvas.getContext('2d');
let W,H,state='idle',t=0;
let cp={r:26,g:107,b:107,glow:0.025,ring:0.1,core:0.03,exit:0.03};
let tp={...cp};

function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight}
window.addEventListener('resize',resize);resize();

const palettes={
  idle:{r:26,g:107,b:107,glow:0.025,ring:0.1,core:0.03,exit:0.03},
  listening:{r:42,g:157,b:143,glow:0.06,ring:0.22,core:0.08,exit:0.1},
  speaking:{r:0,g:229,b:204,glow:0.14,ring:0.4,core:0.25,exit:0.3},
  thinking:{r:107,g:125,b:179,glow:0.04,ring:0.15,core:0.06,exit:0.05}
};

let liveAmp=0;
function handleMsg(e){
  try{
    const d=JSON.parse(e.data);
    if(d.state&&palettes[d.state]){state=d.state;tp=palettes[d.state]}
    if(d.amplitude!==undefined){liveAmp=d.amplitude}
  }catch{}
}
window.addEventListener('message',handleMsg);
document.addEventListener('message',handleMsg);

function lerp(a,b,s){return a+(b-a)*s}
function lerpP(c,t,s){return{r:lerp(c.r,t.r,s),g:lerp(c.g,t.g,s),b:lerp(c.b,t.b,s),glow:lerp(c.glow||0,t.glow||0,s),ring:lerp(c.ring||0,t.ring||0,s),core:lerp(c.core||0,t.core||0,s),exit:lerp(c.exit||0,t.exit||0,s)}}

const LAYERS=4;
function getWaveY(x,layer,time){
  const speed=state==='speaking'?3:state==='listening'?1.5:state==='thinking'?0.8:0.4;
  const complexity=state==='speaking'?5:state==='listening'?3:state==='thinking'?3:2;
  const lo=layer*1.5;
  let y=0;
  for(let h=1;h<=complexity;h++){
    const freq=h*2.5+layer*0.7;
    const phase=time*speed*(1+h*0.3)+lo;
    const ha=1/(h*0.7);
    y+=Math.sin(x*freq*Math.PI+phase)*ha;
    y+=Math.sin(x*freq*3.7+phase*1.3)*ha*0.25;
  }
  if(state==='thinking')y*=0.5+Math.sin(time*0.6+x*2)*0.5;
  return y;
}

function draw(){
  t+=0.016;
  ctx.clearRect(0,0,W,H);
  cp=lerpP(cp,tp,0.04);
  const p=cp;
  const R=Math.round(p.r),G=Math.round(p.g),B=Math.round(p.b);
  const cx=W/2,cy=H/2;
  const orbR=Math.min(W,H)*0.18;
  const baseAmp=state==='speaking'?orbR*0.25:state==='listening'?orbR*0.1:state==='thinking'?orbR*0.1:orbR*0.04;
  const amp=baseAmp+liveAmp*orbR*2.5;
  const wL=cx-orbR*3,wR=cx+orbR*3,wW=wR-wL;

  // Background glow
  const bg=ctx.createRadialGradient(cx,cy,orbR*0.3,cx,cy,orbR*2.5);
  bg.addColorStop(0,'rgba('+R+','+G+','+B+','+(p.glow*1.5)+')');
  bg.addColorStop(0.5,'rgba('+R+','+G+','+B+','+p.glow+')');
  bg.addColorStop(1,'rgba('+(R>>1)+','+(G>>1)+','+(B>>1)+',0)');
  ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);

  // Orb fill
  const og=ctx.createRadialGradient(cx,cy-orbR*0.15,orbR*0.1,cx,cy,orbR);
  og.addColorStop(0,'rgba('+Math.min(255,R+60)+','+Math.min(255,G+40)+','+Math.min(255,B+30)+','+(p.core*0.8)+')');
  og.addColorStop(0.5,'rgba('+R+','+G+','+B+','+(p.core*0.4)+')');
  og.addColorStop(1,'rgba('+(R>>1)+','+(G>>1)+','+(B>>1)+','+(p.core*0.1)+')');
  ctx.beginPath();ctx.arc(cx,cy,orbR,0,Math.PI*2);ctx.fillStyle=og;ctx.fill();

  // Orb rings
  const breathe=1+Math.sin(t*1.2)*(state==='idle'?0.005:0.012);
  ctx.beginPath();ctx.arc(cx,cy,orbR*breathe,0,Math.PI*2);
  ctx.strokeStyle='rgba('+R+','+G+','+B+','+p.ring+')';ctx.lineWidth=1.5;ctx.stroke();
  ctx.beginPath();ctx.arc(cx,cy,orbR*breathe*1.02,0,Math.PI*2);
  ctx.strokeStyle='rgba('+R+','+G+','+B+','+(p.ring*0.3)+')';ctx.lineWidth=0.8;ctx.stroke();

  // Wave layers outside orb
  for(let layer=LAYERS-1;layer>=0;layer--){
    const la=amp*(1-layer*0.15);
    const alpha=(0.15+(LAYERS-layer)*0.12)*(state==='idle'?0.5:1);
    const lr=R-20+layer*20,lg=G-10+layer*12,lb=B-10+layer*10;
    const wp=[];
    for(let px=0;px<=W;px+=2){
      const nx=(px-wL)/wW;
      const d=Math.abs(px-cx)/(orbR*3);
      const env=Math.exp(-d*d*3);
      const wave=getWaveY(nx,layer,t);
      wp.push({x:px,y:cy+wave*la*env});
    }
    ctx.save();
    ctx.beginPath();ctx.rect(0,0,W,H);ctx.arc(cx,cy,orbR*breathe-1,0,Math.PI*2,true);ctx.clip();

    // Upper fill
    ctx.beginPath();ctx.moveTo(0,cy);
    for(const pt of wp)ctx.lineTo(pt.x,pt.y);
    ctx.lineTo(W,cy);ctx.lineTo(W,0);ctx.lineTo(0,0);ctx.closePath();
    const ug=ctx.createLinearGradient(0,cy-la,0,cy);
    ug.addColorStop(0,'rgba('+lr+','+lg+','+lb+',0)');
    ug.addColorStop(0.5,'rgba('+lr+','+lg+','+lb+','+(alpha*0.5)+')');
    ug.addColorStop(1,'rgba('+lr+','+lg+','+lb+','+alpha+')');
    ctx.fillStyle=ug;ctx.fill();

    // Lower fill (mirror)
    ctx.beginPath();ctx.moveTo(0,cy);
    for(const pt of wp)ctx.lineTo(pt.x,cy-(pt.y-cy)*0.55);
    ctx.lineTo(W,cy);ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath();
    const dg=ctx.createLinearGradient(0,cy,0,cy+la);
    dg.addColorStop(0,'rgba('+lr+','+lg+','+lb+','+alpha+')');
    dg.addColorStop(0.5,'rgba('+lr+','+lg+','+lb+','+(alpha*0.5)+')');
    dg.addColorStop(1,'rgba('+lr+','+lg+','+lb+',0)');
    ctx.fillStyle=dg;ctx.fill();

    // Wave strokes
    ctx.beginPath();
    for(let i=0;i<wp.length;i++)i===0?ctx.moveTo(wp[i].x,wp[i].y):ctx.lineTo(wp[i].x,wp[i].y);
    ctx.strokeStyle='rgba('+Math.min(255,lr+60)+','+Math.min(255,lg+50)+','+Math.min(255,lb+40)+','+(alpha*0.9)+')';
    ctx.lineWidth=1.5;ctx.stroke();
    ctx.beginPath();
    for(let i=0;i<wp.length;i++){const my=cy-(wp[i].y-cy)*0.55;i===0?ctx.moveTo(wp[i].x,my):ctx.lineTo(wp[i].x,my)}
    ctx.strokeStyle='rgba('+Math.min(255,lr+30)+','+Math.min(255,lg+30)+','+Math.min(255,lb+20)+','+(alpha*0.4)+')';
    ctx.lineWidth=1;ctx.stroke();
    ctx.restore();
  }

  // Inner orb wave
  ctx.save();
  ctx.beginPath();ctx.arc(cx,cy,orbR*breathe-1,0,Math.PI*2);ctx.clip();
  const ila=state==='speaking'?0.35:state==='listening'?0.15:state==='thinking'?0.1:0.04;
  for(let spread=3;spread>=1;spread--){
    ctx.beginPath();
    for(let px=cx-orbR;px<=cx+orbR;px+=2){
      const nx=(px-(cx-orbR))/(orbR*2);
      const wave=getWaveY(nx,0,t);
      const ia=amp*0.25;
      px===cx-orbR?ctx.moveTo(px,cy+wave*ia):ctx.lineTo(px,cy+wave*ia);
    }
    ctx.strokeStyle='rgba('+R+','+G+','+B+','+(ila*0.12/spread)+')';
    ctx.lineWidth=spread*10;ctx.stroke();
  }
  const ig=ctx.createLinearGradient(cx-orbR,cy,cx+orbR,cy);
  ig.addColorStop(0,'rgba('+R+','+G+','+B+',0)');
  ig.addColorStop(0.2,'rgba('+R+','+G+','+B+','+(ila*0.5)+')');
  ig.addColorStop(0.5,'rgba('+Math.min(255,R+80)+','+Math.min(255,G+60)+','+Math.min(255,B+50)+','+ila+')');
  ig.addColorStop(0.8,'rgba('+R+','+G+','+B+','+(ila*0.5)+')');
  ig.addColorStop(1,'rgba('+R+','+G+','+B+',0)');
  ctx.beginPath();
  for(let px=cx-orbR;px<=cx+orbR;px+=2){
    const nx=(px-(cx-orbR))/(orbR*2);
    const wave=getWaveY(nx,0,t);
    const ia=amp*0.25;
    px===cx-orbR?ctx.moveTo(px,cy+wave*ia):ctx.lineTo(px,cy+wave*ia);
  }
  ctx.strokeStyle=ig;ctx.lineWidth=2.5;ctx.stroke();
  ctx.restore();

  // Exit bloom
  for(const side of[-1,1]){
    const ex=cx+side*orbR;
    const eg=ctx.createRadialGradient(ex,cy,0,ex,cy,orbR*0.4);
    eg.addColorStop(0,'rgba('+Math.min(255,R+80)+','+Math.min(255,G+60)+','+Math.min(255,B+50)+','+p.exit+')');
    eg.addColorStop(1,'rgba('+R+','+G+','+B+',0)');
    ctx.fillStyle=eg;ctx.beginPath();ctx.arc(ex,cy,orbR*0.4,0,Math.PI*2);ctx.fill();
  }
  requestAnimationFrame(draw);
}
draw();
<\/script></body></html>`;
}

export default function KiraOrb({ state, audioLevel = 0 }: KiraOrbProps) {
  const webViewRef = useRef<WebView>(null);
  const audioLevelIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAudioLevelRef = useRef(0);

  // Map voice states to orb states
  const orbState: string =
    state === "playing" ? "speaking"
    : state === "speechDetected" ? "listening"
    : state === "thinking" ? "thinking"
    : state === "listening" ? "listening"
    : "idle";

  useEffect(() => {
    webViewRef.current?.postMessage(JSON.stringify({ state: orbState }));
  }, [orbState]);

  // Stream audio level to WebView at ~20fps
  useEffect(() => {
    audioLevelIntervalRef.current = setInterval(() => {
      if (audioLevel !== lastAudioLevelRef.current) {
        lastAudioLevelRef.current = audioLevel;
        webViewRef.current?.postMessage(JSON.stringify({ amplitude: audioLevel }));
      }
    }, 50);
    return () => {
      if (audioLevelIntervalRef.current) clearInterval(audioLevelIntervalRef.current);
    };
  }, [audioLevel]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html: getCanvasHTML() }}
        style={styles.webview}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        javaScriptEnabled
        originWhitelist={["*"]}
        androidLayerType="hardware"
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0A0F",
  },
  webview: {
    flex: 1,
    backgroundColor: "transparent",
  },
});
