import{M as Tt,N as de,O as E,Q as qa,R as Ie,S as he,V as ot,W as U,X as ht,Y as Vt,Z as Ka,_ as Va,$ as ja,a0 as Wn,G as C,a1 as R,a2 as w,a3 as Q,a4 as Dt,a5 as Ce,a6 as Do,a7 as Oo,p as Fo,a8 as tn,a9 as Mt,aa as $o,ab as Ya,ac as Ha,ad as Qa,ae as ge,af as en,ag as Bo,ah as No,ai as Wo,aj as Za,ak as Ja,al as ti,am as Uo,an as Un,ao as ei,ap as ni,aq as oi,ar as ri}from"./compositor.worker-CO4AwqAM.js";class ai extends Error{constructor(e){super(`WorkerPool: unknown task "${e}" (no worker handler and no local handler registered)`),this.task=e,this.name="UnknownTaskError"}}class zn extends Error{constructor(e){super(`WorkerPool: task "${e}" aborted`),this.task=e,this.name="AbortError"}}class ii extends Error{constructor(e,n,o,r){super(o),this.task=e,this.remoteName=n,this.remoteStack=r,this.name=n||"RemoteTaskError"}}function si(){const t=typeof navigator<"u"?navigator.hardwareConcurrency||4:2;return Math.max(1,t-1)}class ci{size;createWorker;slots=[];queue=[];local=new Map;remoteUnknown=new Set;nextId=1;disposed=!1;constructor(e={}){this.size=Math.max(1,e.size??si()),this.createWorker=e.createWorker??null;for(const[n,o]of Object.entries(e.local??{}))this.local.set(n,o)}register(e,n){return this.local.set(e,n),()=>{this.local.get(e)===n&&this.local.delete(e)}}has(e){return this.local.has(e)||this.createWorker!==null&&!this.remoteUnknown.has(e)}run(e,n,o,r){return this.disposed?Promise.reject(new Error("WorkerPool disposed")):r?.aborted?Promise.reject(new zn(e)):this.createWorker===null||this.remoteUnknown.has(e)?this.runLocal(e,n,r):new Promise((a,i)=>{const s={id:this.nextId++,task:e,input:n,transfer:o,signal:r,resolve:a,reject:i,settled:!1};r&&(s.onAbort=()=>this.abortPending(s),r.addEventListener("abort",s.onAbort,{once:!0})),this.queue.push(s),this.dispatch()})}stats(){return{workers:this.slots.length,busy:this.slots.filter(e=>e.current!==null).length,queued:this.queue.length}}dispose(){this.disposed=!0;for(const e of this.slots)e.current&&this.settle(e.current,"reject",new Error("WorkerPool disposed")),e.worker.terminate();this.slots.length=0;for(const e of this.queue.splice(0))this.settle(e,"reject",new Error("WorkerPool disposed"))}runLocal(e,n,o){const r=this.local.get(e);if(!r)return Promise.reject(new ai(e));const a=new AbortController,i=()=>a.abort();return o?.addEventListener("abort",i,{once:!0}),Promise.resolve().then(()=>r(n,{signal:a.signal})).finally(()=>o?.removeEventListener("abort",i))}dispatch(){for(;this.queue.length>0;){let e=this.slots.find(r=>r.current===null);if(!e&&this.slots.length<this.size&&(e=this.spawn()),!e)return;const n=this.queue.shift();if(n.settled)continue;e.current=n;const o={t:"run",id:n.id,task:n.task,input:n.input};try{e.worker.postMessage(o,n.transfer)}catch(r){e.current=null,this.settle(n,"reject",r)}}}spawn(){const e=this.createWorker(),n={worker:e,current:null};return e.onmessage=o=>this.onMessage(n,o.data),e.onerror=o=>this.onWorkerError(n,o),this.slots.push(n),n}onMessage(e,n){if(!n||typeof n!="object")return;const o=e.current;if(!(!o||o.id!==n.id)){if(e.current=null,n.t==="done")this.settle(o,"resolve",n.result);else if(n.unknownTask){if(this.remoteUnknown.add(o.task),!o.settled){this.detachAbort(o),o.settled=!0;const r="input"in n&&n.input!==void 0?n.input:o.input;o.transfer&&o.transfer.length>0&&!("input"in n)?o.reject(new Error(`WorkerPool: task "${o.task}" is unknown to the worker and its transferred input was not returned; cannot run locally`)):this.runLocal(o.task,r,o.signal).then(o.resolve,o.reject)}}else this.settle(o,"reject",new ii(o.task,n.error.name,n.error.message,n.error.stack));this.dispatch()}}onWorkerError(e,n){const o=n instanceof Error?n:new Error(`Worker error: ${li(n)}`),r=this.slots.indexOf(e);r>=0&&this.slots.splice(r,1);try{e.worker.terminate()}catch{}if(e.current){const a=e.current;e.current=null,this.settle(a,"reject",o)}this.dispatch()}abortPending(e){if(e.settled)return;const n=this.slots.find(o=>o.current===e);if(n){const o={t:"abort",id:e.id};try{n.worker.postMessage(o)}catch{}n.current={...e,settled:!0,resolve:()=>{},reject:()=>{}}}else{const o=this.queue.indexOf(e);o>=0&&this.queue.splice(o,1)}this.settle(e,"reject",new zn(e.task)),this.dispatch()}settle(e,n,o){e.settled||(e.settled=!0,this.detachAbort(e),n==="resolve"?e.resolve(o):e.reject(o))}detachAbort(e){e.signal&&e.onAbort&&e.signal.removeEventListener("abort",e.onAbort)}}function li(t){return t&&typeof t=="object"&&"message"in t?String(t.message):String(t)}function ui(t){return new ci(t)}const Gn="og-w-eyedropping";function Ke(t){return t?t.length>=4?[t[0],t[1],t[2],t[3]]:[t[0],t[1],t[2],255]:null}function fi(t){const[e,n]=Ie(!1),o=de(t);o.current=t;const r=de(null),a=i=>{r.current?.abort(),r.current=null,n(!1),o.current.onEnd?.(i)};return he(()=>{if(!e)return;const i=o.current,s=i.doc??(typeof document<"u"?document:void 0);if(!s)return;const c=s.documentElement;c?.classList.add(Gn);let l=0,u=!1;const f=g=>{const _=g;return!!_&&(o.current.exclude??[]).some(y=>!!y.current&&y.current.contains(_))},m=g=>{if(f(g.target)||g.pointerType==="mouse"&&g.button!==0)return;g.preventDefault(),g.stopPropagation(),g.stopImmediatePropagation();const _=o.current,y={x:g.clientX,y:g.clientY};if(!_.sample)return;const x=_.once!==!1;Promise.resolve(_.sample(y,g)).then(b=>{if(u&&x)return;const M=Ke(b);M&&o.current.onPick(M,y),x&&a("picked")},b=>{console.error("[widgets] eyedropper sample failed",b),x&&a("cancel")})},d=g=>{f(g.target)||(g.preventDefault(),g.stopPropagation())},h=g=>{const _=o.current;if(!_.onHover||!_.sample)return;const y=++l,x={x:g.clientX,y:g.clientY};Promise.resolve(_.sample(x,g)).then(b=>{y===l&&!u&&o.current.onHover?.(Ke(b),x)},()=>{y===l&&!u&&o.current.onHover?.(null,x)})},p=g=>{g.key==="Escape"&&(g.preventDefault(),g.stopPropagation(),a("cancel"))};if(s.addEventListener("pointerdown",m,!0),s.addEventListener("pointerup",d,!0),s.addEventListener("click",d,!0),s.addEventListener("pointermove",h,!0),s.addEventListener("keydown",p,!0),!i.sample&&i.adapter){const g=new AbortController;r.current=g,i.adapter.pick(g.signal).then(_=>{if(g.signal.aborted)return;const y=Ke(_);y&&o.current.onPick(y,null),a(y?"picked":"cancel")},()=>{g.signal.aborted||a("cancel")})}return()=>{u=!0,c?.classList.remove(Gn),s.removeEventListener("pointerdown",m,!0),s.removeEventListener("pointerup",d,!0),s.removeEventListener("click",d,!0),s.removeEventListener("pointermove",h,!0),s.removeEventListener("keydown",p,!0)}},[e]),he(()=>()=>{r.current?.abort(),r.current=null},[]),{active:e,start:()=>{const i=o.current;!i.sample&&!i.adapter||n(!0)},cancel:()=>{e&&a("cancel")}}}function yn(t){const e=Tt(),n=de(null),o=fi({...t,exclude:[...t.exclude??[],n]}),r=!!t.sample||!!t.adapter;return E("span",{ref:n,class:"og-w-eyedropper","data-active":o.active?"true":void 0,children:E(qa,{class:t.class,icon:t.icon??E(mi,{}),label:t.label??e("widgets.eyedropper.label"),pressed:o.active,disabled:t.disabled||!r,onClick:()=>o.active?o.cancel():o.start()})})}function mi(){return E("svg",{class:"og-w-icon og-w-eyedropper__glyph",width:16,height:16,viewBox:"0 0 24 24","aria-hidden":"true",focusable:"false",children:E("path",{d:"M14 4l6 6-2 2-6-6z M13 9l-8 8v2h2l8-8",fill:"none",stroke:"currentColor","stroke-width":"1.6","stroke-linejoin":"round"})})}const v=t=>Vt(`filters.${t}`),_n={gaussianBlur:U("filters.gaussianBlur"),blur:U("filters.blur"),blurMore:U("filters.blurMore"),smoothing:U("filters.smoothing"),sharpen:U("filters.sharpen"),sharpenMore:U("filters.sharpenMore"),pixelate:U("filters.pixelate"),brightnessToOpacity:U("filters.brightnessToOpacity")},st={brightnessContrast:ot("brightnessContrast"),levels:ot("levels"),hsl:ot("hsl"),invert:ot("invert"),posterize:ot("posterize"),binarize:ot("binarize"),curves:ot("curves"),colorBalance:ot("colorBalance"),gradientMap:ot("gradientMap"),colorReplace:ot("colorReplace")},zo={repeatLast:ht("filters.repeatLast")},di=t=>`filters.correction.${t}`,Xn={repeat:"filter.repeat",editCorrection:"edit.correction"},dt={repeatLast:v("command.repeatLast"),noTarget:v("error.noTarget"),notRaster:v("error.notRaster"),locked:v("error.locked"),nothingToRepeat:v("error.nothingToRepeat"),progress:v("progress.running"),correctionMenu:v("menu.correction")},hi=`void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`,gi=`uniform sampler2D u_src;
uniform sampler2D u_orig;
uniform ivec2 u_srcSize;
uniform ivec2 u_dstSize;
uniform ivec2 u_origSize;
uniform int u_apron;
uniform int u_iteration;
out vec4 fragColor;
ivec2 og_pixel() { return ivec2(gl_FragCoord.xy); }
vec4 og_src(ivec2 p) {
  return (p.x < 0 || p.y < 0 || p.x >= u_srcSize.x || p.y >= u_srcSize.y) ? vec4(0.0) : texelFetch(u_src, p, 0);
}
vec4 og_srcClamp(ivec2 p) { return texelFetch(u_src, clamp(p, ivec2(0), u_srcSize - 1), 0); }
vec4 og_orig(ivec2 p) {
  return (p.x < 0 || p.y < 0 || p.x >= u_origSize.x || p.y >= u_origSize.y) ? vec4(0.0) : texelFetch(u_orig, p, 0);
}
vec4 og_i8(vec4 v) { return floor(v * 255.0 + 0.5); }
`,k={TEXTURE_2D:3553,TEXTURE0:33984,RGBA:6408,RGBA8:32856,UNSIGNED_BYTE:5121,NEAREST:9728,CLAMP_TO_EDGE:33071,TEXTURE_MIN_FILTER:10241,TEXTURE_MAG_FILTER:10240,TEXTURE_WRAP_S:10242,TEXTURE_WRAP_T:10243,UNPACK_ALIGNMENT:3317,UNPACK_FLIP_Y_WEBGL:37440,UNPACK_PREMULTIPLY_ALPHA_WEBGL:37441,UNPACK_COLORSPACE_CONVERSION_WEBGL:37443,NONE:0,FRAMEBUFFER:36160,BLEND:3042,SCISSOR_TEST:3089,DEPTH_TEST:2929,STENCIL_TEST:2960,TRIANGLES:4,ACTIVE_UNIFORMS:35718,FLOAT:5126,FLOAT_VEC2:35664,FLOAT_VEC3:35665,FLOAT_VEC4:35666,INT:5124,INT_VEC2:35667,INT_VEC3:35668,INT_VEC4:35669,BOOL:35670,SAMPLER_2D:35678,FLOAT_MAT3:35675,FLOAT_MAT4:35676},pi=new Set(["u_src","u_orig","u_srcSize","u_dstSize","u_origSize","u_apron","u_iteration"]);class vt extends Error{constructor(e){super(`filters: GPU path unavailable (${e})`),this.name="GpuFilterUnavailableError"}}function yi(t){let e=2166136261;for(let n=0;n<t.length;n++)e^=t.charCodeAt(n),e=Math.imul(e,16777619)>>>0;return e.toString(16).padStart(8,"0")}const _i=t=>typeof t=="number"?[t]:typeof t=="boolean"?[t?1:0]:t;class vi{constructor(e){this.gpu=e,e.onLost(()=>{this.vao=null,this.uniforms.clear()})}vao=null;programs=new Map;uniforms=new Map;program(e){const n=`filters.${yi(e)}`;let o=this.programs.get(n);return o||(o=this.gpu.shaders.program(n,hi,`${gi}${e}`),this.programs.set(n,o)),o}use(e){const n=ja(this.gpu,e);let o=this.uniforms.get(e.id);if(!o){o=new Map;const r=this.gpu.gl,a=Number(r.getProgramParameter(n,k.ACTIVE_UNIFORMS))||0;for(let i=0;i<a;i++){const s=r.getActiveUniform(n,i);if(!s)continue;const c=s.name.replace(/\[0\]$/,"");o.set(c,{loc:Wn(this.gpu,e,s.name)??Wn(this.gpu,e,c),type:s.type,size:s.size})}this.uniforms.set(e.id,o)}return o}draw(){const e=this.gpu.gl;this.vao||(this.vao=e.createVertexArray()),e.bindVertexArray(this.vao),e.drawArrays(k.TRIANGLES,0,3),e.bindVertexArray(null)}}const qn=new WeakMap;function xi(t){let e=qn.get(t);return e||(e=new vi(t),qn.set(t,e)),e}function Go(t,e,n,o){const r=t.createTexture();if(!r)throw new vt("createTexture failed");t.bindTexture(k.TEXTURE_2D,r),t.texParameteri(k.TEXTURE_2D,k.TEXTURE_MIN_FILTER,k.NEAREST),t.texParameteri(k.TEXTURE_2D,k.TEXTURE_MAG_FILTER,k.NEAREST),t.texParameteri(k.TEXTURE_2D,k.TEXTURE_WRAP_S,k.CLAMP_TO_EDGE),t.texParameteri(k.TEXTURE_2D,k.TEXTURE_WRAP_T,k.CLAMP_TO_EDGE),t.pixelStorei(k.UNPACK_ALIGNMENT,1),t.pixelStorei(k.UNPACK_FLIP_Y_WEBGL,0),t.pixelStorei(k.UNPACK_PREMULTIPLY_ALPHA_WEBGL,0),t.pixelStorei(k.UNPACK_COLORSPACE_CONVERSION_WEBGL,k.NONE);const a=o instanceof Uint8Array?o:new Uint8Array(o.buffer,o.byteOffset,o.byteLength);return t.texImage2D(k.TEXTURE_2D,0,k.RGBA8,e,n,0,k.RGBA,k.UNSIGNED_BYTE,a),r}function wi(t,e,n,o,r){const a=e.loc;if(a===null)return;const i=_i(n);switch(e.type){case k.FLOAT:e.size>1?t.uniform1fv(a,Float32Array.from(i)):t.uniform1f(a,Number(i[0]??0));return;case k.FLOAT_VEC2:t.uniform2fv(a,Float32Array.from(i));return;case k.FLOAT_VEC3:t.uniform3fv(a,Float32Array.from(i));return;case k.FLOAT_VEC4:t.uniform4fv(a,Float32Array.from(i));return;case k.FLOAT_MAT3:t.uniformMatrix3fv(a,!1,Float32Array.from(i));return;case k.FLOAT_MAT4:t.uniformMatrix4fv(a,!1,Float32Array.from(i));return;case k.INT:case k.BOOL:e.size>1?t.uniform1iv(a,Int32Array.from(i,s=>Math.round(s))):t.uniform1i(a,Math.round(Number(i[0]??0)));return;case k.INT_VEC2:t.uniform2iv(a,Int32Array.from(i,s=>Math.round(s)));return;case k.INT_VEC3:t.uniform3iv(a,Int32Array.from(i,s=>Math.round(s)));return;case k.INT_VEC4:t.uniform4iv(a,Int32Array.from(i,s=>Math.round(s)));return;case k.SAMPLER_2D:{const s=i.length>>2;if(s===0)return;const c=Math.min(256,s),l=Math.ceil(s/c),u=new Uint8Array(c*l*4);for(let d=0;d<i.length&&d<u.length;d++)u[d]=Math.max(0,Math.min(255,Math.round(Number(i[d]))));const f=o();t.activeTexture(k.TEXTURE0+f);const m=Go(t,c,l,u);r.push(m),t.uniform1i(a,f);return}default:return}}function bi(t,e,n,o){if(t.gpuPlan)return t.gpuPlan(e,n,o);if(!t.gpu)throw new vt(`${t.id} has no gpu passes`);const r=t.gpu.uniforms(e,n);return t.gpu.passes.map(a=>({frag:a.frag,...a.iterations!==void 0?{iterations:a.iterations}:{},...a.scale!==void 0?{scale:a.scale}:{},uniforms:r}))}const Kn=t=>!!t.gpuPlan||!!t.gpu;async function Mi(t,e,n,o,r,a={}){if(t.lost.value)throw new vt("context lost");const i=o.apronPx,s=o.w-2*i,c=o.h-2*i;if(s<=0||c<=0)return new Uint8ClampedArray(0);const l=t.caps.maxTextureSize;if(o.w>l||o.h>l)throw new vt(`region ${o.w}x${o.h} > MAX_TEXTURE_SIZE`);const u={w:o.w,h:o.h,apron:i,origin:o.origin},f=bi(e,n,r,u);if(f.length===0)throw new vt("no passes");const m=t.caps.renderableRgba16f??t.caps.colorBufferFloat;if(!m&&a.allowRgba8Intermediate===!1)throw new vt("no float render target");const d=xi(t),h=t.gl;let p=o.data;if(o.stride!==o.w*4||o.data.length!==o.w*o.h*4){p=new Uint8ClampedArray(o.w*o.h*4);for(let I=0;I<o.h;I++)p.set(o.data.subarray(I*o.stride,I*o.stride+o.w*4),I*o.w*4)}const g=[],_=Go(h,o.w,o.h,p);g.push(_),h.disable(k.BLEND),h.disable(k.SCISSOR_TEST),h.disable(k.DEPTH_TEST),h.disable(k.STENCIL_TEST),h.colorMask(!0,!0,!0,!0);let y=_,x=o.w,b=o.h,M=null;const P=f.reduce((I,O)=>I+Math.max(1,O.iterations??1),0);let L=0;try{for(const A of f){const B=Math.max(1,Math.floor(A.iterations??1));for(let W=0;W<B;W++){L++;const N=L===P,V=A.size?A.size.w:Math.max(1,Math.round(x*(A.scale??1))),S=A.size?A.size.h:Math.max(1,Math.round(b*(A.scale??1))),X=(A.precision??(N?"rgba8":"float"))==="float"&&m?"rgba16f":"rgba8",q=t.fbo.acquire(V,S,X);Ka(t,q);const T=d.program(A.frag),j=d.use(T);let J=2;const ct=()=>J++;h.activeTexture(k.TEXTURE0),h.bindTexture(k.TEXTURE_2D,y),h.activeTexture(k.TEXTURE0+1),h.bindTexture(k.TEXTURE_2D,_);const z=(et,pt)=>{const yt=j.get(et);yt&&wi(h,yt,pt,ct,g)},tt=(et,pt)=>{const yt=j.get(et);yt?.loc&&h.uniform1i(yt.loc,pt)};if(tt("u_src",0),tt("u_orig",1),z("u_srcSize",[x,b]),z("u_dstSize",[V,S]),z("u_origSize",[o.w,o.h]),z("u_apron",i),z("u_iteration",W),A.uniforms)for(const[et,pt]of Object.entries(A.uniforms))pi.has(et)||z(et,pt);d.draw();const lt=M;M=q;const Pt=Va(t,q);if(!Pt)throw new vt("FBO texture missing");y=Pt,x=V,b=S,lt&&t.fbo.release(lt)}}for(let A=0;A<8;A++)h.activeTexture(k.TEXTURE0+A),h.bindTexture(k.TEXTURE_2D,null);h.activeTexture(k.TEXTURE0),h.bindFramebuffer(k.FRAMEBUFFER,null);for(const A of g)h.deleteTexture(A);g.length=0;const I=M;let O;if(x===s&&b===c)O={x:0,y:0,w:s,h:c};else if(x===o.w&&b===o.h)O={x:i,y:i,w:s,h:c};else throw new Error(`filters: last pass output ${x}x${b} is neither inner ${s}x${c} nor full ${o.w}x${o.h}`);if(I.fmt!=="rgba8")throw new Error("filters: last pass must be rgba8");const $=await t.readback.read(I,O,"commit");return t.fbo.release(I),M=null,$}finally{if(g.length){for(const I of g)h.deleteTexture(I);h.bindFramebuffer(k.FRAMEBUFFER,null)}M&&t.fbo.release(M)}}const vn=t=>({x:t.tx*C,y:t.ty*C,w:C,h:C});function H(t,e){const n=Math.max(t.x,e.x),o=Math.max(t.y,e.y),r=Math.min(t.x+t.w,e.x+e.w),a=Math.min(t.y+t.h,e.y+e.h);return r>n&&a>o?{x:n,y:o,w:r-n,h:a-o}:null}const Xo=(t,e)=>({x:t.x-e,y:t.y-e,w:t.w+2*e,h:t.h+2*e});function Se(t){if(t.w<=0||t.h<=0)return[];const e=Math.floor(t.x/C),n=Math.floor(t.y/C),o=Math.floor((t.x+t.w-1)/C),r=Math.floor((t.y+t.h-1)/C),a=[];for(let i=n;i<=r;i++)for(let s=e;s<=o;s++)a.push({tx:s,ty:i});return a}async function qo(t){const e=t.tryCpu();return e?e.data:(await t.cpu()).data}function nn(t,e,n,o,r,a=e.w*r,i=o.w*r){const s=H(e,o);if(!s)return;const c=s.w*r;for(let l=s.y;l<s.y+s.h;l++){const u=(l-e.y)*a+(s.x-e.x)*r,f=(l-o.y)*i+(s.x-o.x)*r;n.set(t.subarray(u,u+c),f)}}async function De(t,e,n,o={}){const r=new Uint8ClampedArray(e.w*e.h*4),a=t.format==="a8",i=a?o.missing??0:0;i&&r.fill(i);const s=n?H(e,n):e;if(!s){if(n&&o.edgeMode==="clamp"&&n.w>0&&n.h>0){const c=Ai(e,n),l=await De(t,c,n,o);ki(r,e,l,c)}return r}for(const c of Se(s)){const l=t.get(c);if(!l)continue;const u=await qo(l),f=vn(c),m=H(f,s);if(m){if(!a){nn(u,f,r,e,4);continue}for(let d=m.y;d<m.y+m.h;d++){let h=(d-f.y)*C+(m.x-f.x),p=((d-e.y)*e.w+(m.x-e.x))*4;for(let g=0;g<m.w;g++,h++,p+=4){const _=u[h];r[p]=_,r[p+1]=_,r[p+2]=_,r[p+3]=_}}}}return n&&(o.edgeMode==="clamp"?Ko(r,e,s):a?on(r,e,s,i):on(r,e,s,0)),r}function Vn(t,e,n,o,r){if(!n){t.fill(r);return}o==="clamp"?Ko(t,e,n):on(t,e,n,r)}function Ai(t,e){const n=Math.min(Math.max(t.x,e.x),e.x+e.w-1),o=Math.min(Math.max(t.y,e.y),e.y+e.h-1),r=Math.min(Math.max(t.x+t.w-1,e.x),e.x+e.w-1),a=Math.min(Math.max(t.y+t.h-1,e.y),e.y+e.h-1);return{x:n,y:o,w:r-n+1,h:a-o+1}}function ki(t,e,n,o){for(let r=0;r<e.h;r++){const a=Math.min(Math.max(e.y+r,o.y),o.y+o.h-1)-o.y;for(let i=0;i<e.w;i++){const s=Math.min(Math.max(e.x+i,o.x),o.x+o.w-1)-o.x,c=(a*o.w+s)*4,l=(r*e.w+i)*4;t[l]=n[c],t[l+1]=n[c+1],t[l+2]=n[c+2],t[l+3]=n[c+3]}}}function on(t,e,n,o){if(!(n.x===e.x&&n.y===e.y&&n.w===e.w&&n.h===e.h))for(let r=0;r<e.h;r++){const a=e.y+r,i=r*e.w*4;if(a<n.y||a>=n.y+n.h){t.fill(o,i,i+e.w*4);continue}const s=Math.max(0,n.x-e.x),c=Math.min(e.w,n.x+n.w-e.x);s>0&&t.fill(o,i,i+s*4),c<e.w&&t.fill(o,i+c*4,i+e.w*4)}}function Ko(t,e,n){if(n.x===e.x&&n.y===e.y&&n.w===e.w&&n.h===e.h)return;const o=n.x-e.x,r=n.x+n.w-e.x,a=n.y-e.y,i=n.y+n.h-e.y,s=e.w*4;for(let c=a;c<i;c++){const l=c*s,u=l+o*4;for(let m=0;m<o;m++)t.copyWithin(l+m*4,u,u+4);const f=l+(r-1)*4;for(let m=r;m<e.w;m++)t.copyWithin(l+m*4,f,f+4)}for(let c=0;c<a;c++)t.copyWithin(c*s,a*s,(a+1)*s);for(let c=i;c<e.h;c++)t.copyWithin(c*s,(i-1)*s,i*s)}function Ei(t,e,n,o={tx:0,ty:0}){return{data:t,w:e.w,h:e.h,stride:e.w*4,premultiplied:!0,key:o,origin:{x:e.x+n,y:e.y+n},apronPx:n}}function Vo(t,e){for(let n=0;n<e.length;n+=4){const o=t[n+3],r=e[n+3];if(o===0){e[n]=e[n+1]=e[n+2]=e[n+3]=0;continue}if(r===0){e[n]=t[n],e[n+1]=t[n+1],e[n+2]=t[n+2],e[n+3]=o;continue}if(r===o)continue;const a=o/r;e[n]=Math.min(o,Math.floor(e[n]*a+.5)),e[n+1]=Math.min(o,Math.floor(e[n+1]*a+.5)),e[n+2]=Math.min(o,Math.floor(e[n+2]*a+.5)),e[n+3]=o}}function jo(t,e,n,o){if(o<=0)return{data:t,w:e,h:n};const r=1<<o,a=Math.ceil(e/r),i=Math.ceil(n/r),s=new Uint8ClampedArray(a*i*4),c=1/(r*r);for(let l=0;l<i;l++)for(let u=0;u<a;u++){let f=0,m=0,d=0,h=0;for(let g=0;g<r;g++){const _=l*r+g;if(_>=n)break;for(let y=0;y<r;y++){const x=u*r+y;if(x>=e)break;const b=(_*e+x)*4;f+=t[b],m+=t[b+1],d+=t[b+2],h+=t[b+3]}}const p=(l*a+u)*4;s[p]=Math.floor(f*c+.5),s[p+1]=Math.floor(m*c+.5),s[p+2]=Math.floor(d*c+.5),s[p+3]=Math.floor(h*c+.5)}return{data:s,w:a,h:i}}const Yo=2,F=t=>t,re=32,Ho=`#define MAX_TAPS ${re}
uniform int u_rad;
uniform float u_weights[MAX_TAPS];
uniform ivec2 u_offset;
`,ae=`${Ho}
void main() {
  ivec2 p = og_pixel() + u_offset;
  vec4 acc = og_srcClamp(p) * u_weights[0];
  for (int i = 1; i <= u_rad; i++) {
    acc += (og_srcClamp(p + ivec2(i, 0)) + og_srcClamp(p - ivec2(i, 0))) * u_weights[i];
  }
  fragColor = acc;
}
`,rn=`${Ho}
void main() {
  ivec2 p = og_pixel() + u_offset;
  vec4 acc = og_srcClamp(p) * u_weights[0];
  for (int i = 1; i <= u_rad; i++) {
    acc += (og_srcClamp(p + ivec2(0, i)) + og_srcClamp(p - ivec2(0, i))) * u_weights[i];
  }
  acc = clamp(acc, 0.0, 1.0);
  fragColor = vec4(min(acc.rgb, vec3(acc.a)), acc.a);
}
`,Ti=`uniform ivec2 u_phase;
void main() {
  ivec2 b = 2 * og_pixel() - u_phase;
  vec4 s = og_i8(og_src(b)) + og_i8(og_src(b + ivec2(1, 0))) + og_i8(og_src(b + ivec2(0, 1))) + og_i8(og_src(b + ivec2(1, 1)));
  fragColor = floor(s * 0.25 + 0.5) / 255.0;
}
`,Pi=`uniform float u_factor;
uniform ivec2 u_shift;
void main() {
  ivec2 q = og_pixel();
  vec2 f = (vec2(q + u_shift) + 0.5) / u_factor - 0.5;
  f = clamp(f, vec2(0.0), vec2(u_srcSize - 1));
  ivec2 i0 = ivec2(floor(f));
  ivec2 i1 = min(i0 + 1, u_srcSize - 1);
  vec2 t = f - vec2(i0);
  vec4 a = og_i8(texelFetch(u_src, i0, 0));
  vec4 b = og_i8(texelFetch(u_src, ivec2(i1.x, i0.y), 0));
  vec4 c = og_i8(texelFetch(u_src, ivec2(i0.x, i1.y), 0));
  vec4 d = og_i8(texelFetch(u_src, i1, 0));
  vec4 top = a + (b - a) * t.x;
  vec4 bot = c + (d - c) * t.x;
  fragColor = floor(top + (bot - top) * t.y + 0.5) / 255.0;
}
`,Ri=8,Qo=.1,Zo=1e3,Li=R({radius:w().min(Qo).max(Zo).default(10)}).strict();function Gt(t){if(!(t>0))return{n:0,sigmaN:0,rad:0,apron:0};let e=0;for(;t/(1<<e)>Ri&&e<8;)e++;const n=t/(1<<e),o=Math.ceil(3*n),r=e===0?o:(1<<e)*(o+2);return{n:e,sigmaN:n,rad:o,apron:r}}function Ii(t){const e=Math.ceil(3*t),n=new Float64Array(e+1);let o=0;for(let r=-e;r<=e;r++)o+=Math.exp(-(r*r)/(2*t*t));for(let r=0;r<=e;r++)n[r]=Math.exp(-(r*r)/(2*t*t))/o;return n}const pe=(t,e)=>t.radius/(1<<Math.max(0,e));function Ci(t,e,n){const o=e+1>>1,r=n+1>>1,a=new Uint8ClampedArray(o*r*4);for(let i=0;i<r;i++){const s=2*i,c=2*i+1;for(let l=0;l<o;l++){const u=2*l,f=2*l+1,m=(i*o+l)*4;for(let d=0;d<4;d++){let h=t[(s*e+u)*4+d];f<e&&(h+=t[(s*e+f)*4+d]),c<n&&(h+=t[(c*e+u)*4+d],f<e&&(h+=t[(c*e+f)*4+d])),a[m+d]=Math.floor(h/4+.5)}}}return{data:a,w:o,h:r}}const ye=(t,e)=>(t%e+e)%e;function Si(t,e,n,o){const r=pe(e,o.level),a=Gt(r),i=t.apronPx,s=n.w,c=n.h;if(t.w-2*i!==s||t.h-2*i!==c)throw new RangeError(`filters.gaussianBlur: dst ${s}x${c} does not match src ${t.w}x${t.h} minus apron ${i}`);const l=(y,x,b,M)=>{for(let P=0;P<c;P++){const L=((P+M)*x+b)*4;n.data.set(y.subarray(L,L+s*4),P*n.stride)}};if(a.rad===0||a.sigmaN<=0){for(let y=0;y<c;y++){const x=(y+i)*t.stride+i*4;n.data.set(t.data.subarray(x,x+s*4),y*n.stride)}return}if(a.n===0){const y=new Uint8ClampedArray(t.w*t.h*4);for(let x=0;x<t.h;x++)y.set(t.data.subarray(x*t.stride,x*t.stride+t.w*4),x*t.w*4);o.kernels.gaussianBlur({data:y,w:t.w,h:t.h,stride:t.w*4,premultiplied:!0},3*r),l(y,t.w,i,i);return}const u=1<<a.n,f=ye(t.origin.x-i,u),m=ye(t.origin.y-i,u),d=t.w+f,h=t.h+m;let p=new Uint8ClampedArray(d*h*4);for(let y=0;y<t.h;y++)p.set(t.data.subarray(y*t.stride,y*t.stride+t.w*4),((y+m)*d+f)*4);let g=d,_=h;for(let y=0;y<a.n;y++){const x=Ci(p,g,_);p=x.data,g=x.w,_=x.h}o.kernels.gaussianBlur({data:p,w:g,h:_,stride:g*4,premultiplied:!0},3*a.sigmaN);for(let y=0;y<c;y++){const x=Math.min(_-1,Math.max(0,(y+i+m+.5)/u-.5)),b=Math.floor(x),M=Math.min(_-1,b+1),P=x-b;for(let L=0;L<s;L++){const I=Math.min(g-1,Math.max(0,(L+i+f+.5)/u-.5)),O=Math.floor(I),$=Math.min(g-1,O+1),A=I-O,B=(b*g+O)*4,W=(b*g+$)*4,N=(M*g+O)*4,V=(M*g+$)*4,S=y*n.stride+L*4;for(let D=0;D<4;D++){const X=p[B+D]+(p[W+D]-p[B+D])*A,q=p[N+D]+(p[V+D]-p[N+D])*A;n.data[S+D]=Math.floor(X+(q-X)*P+.5)}}}}function ie(t){const e=Ii(t);if(e.length>re)throw new RangeError(`filters.gaussianBlur: ${e.length} taps > ${re}`);const n=new Float32Array(re);return n.set(e),n}function Di(t,e,n){const o=pe(t,e.level),r=Gt(o),a=n.apron,i=n.w-2*a,s=n.h-2*a;if(r.rad===0)return[{frag:ae,size:{w:i,h:s},uniforms:{u_rad:0,u_weights:ie(1e-6),u_offset:[a,a]}}];if(r.n===0){const p=ie(o);return[{frag:ae,size:{w:i,h:n.h},uniforms:{u_rad:r.rad,u_weights:p,u_offset:[a,0]}},{frag:rn,size:{w:i,h:s},uniforms:{u_rad:r.rad,u_weights:p,u_offset:[0,a]}}]}const c=1<<r.n,l=ye(n.origin.x-a,c),u=ye(n.origin.y-a,c);let f=n.w+l,m=n.h+u;const d=[];for(let p=0;p<r.n;p++)f=f+1>>1,m=m+1>>1,d.push({frag:Ti,size:{w:f,h:m},precision:"rgba8",uniforms:{u_phase:p===0?[l,u]:[0,0]}});const h=ie(r.sigmaN);return d.push({frag:ae,size:{w:f,h:m},uniforms:{u_rad:r.rad,u_weights:h,u_offset:[0,0]}}),d.push({frag:rn,size:{w:f,h:m},precision:"rgba8",uniforms:{u_rad:r.rad,u_weights:h,u_offset:[0,0]}}),d.push({frag:Pi,size:{w:i,h:s},uniforms:{u_factor:c,u_shift:[a+l,a+u]}}),d}const Oi=[{key:"radius",categoryId:"correction",labelKey:v("param.gaussianBlur.radius"),type:"number",min:Qo,max:Zo,step:.1,log:!0,unit:"px",display:"numeric",hasDynamics:!1,dynamicsAllowed:[]}],Fi={id:_n.gaussianBlur,titleKey:Vt("filters.filter.gaussianBlur"),category:"blur",params:F(Li),meta:Oi,apronPx:t=>Gt(t.radius).apron,apronAt:(t,e)=>Gt(pe(t,e)).apron,gpu:{passes:[{frag:ae},{frag:rn}],uniforms:(t,e)=>{const n=Gt(pe(t,e.level));return{u_rad:n.rad,u_weights:ie(Math.max(n.sigmaN,1e-6)),u_offset:[0,0]}}},gpuPlan:(t,e,n)=>Di(t,e,n),cpu:Si,previewStrategy:"proxy",recordable:!0},an=25,$i=3,Jo=t=>(Math.sqrt(t.length)-1)/2,Bi={id:"filters.blur",titleKey:"filters.filter.blur",category:"blur",kernel:[1,2,1,2,4,2,1,2,1],div:16},jn=[1,4,6,4,1],Ni={id:"filters.blurMore",titleKey:"filters.filter.blurMore",category:"blur",kernel:jn.flatMap(t=>jn.map(e=>t*e)),div:256},Wi={id:"filters.smoothing",titleKey:"filters.filter.smoothing",category:"blur",kernel:[1,1,1,1,4,1,1,1,1],div:12},Ui={id:"filters.sharpen",titleKey:"filters.filter.sharpen",category:"sharpen",kernel:[0,-1,0,-1,8,-1,0,-1,0],div:4},zi={id:"filters.sharpenMore",titleKey:"filters.filter.sharpenMore",category:"sharpen",kernel:[-1,-1,-1,-1,12,-1,-1,-1,-1],div:4},tr=t=>4**Math.max(0,Math.min($i,t)),Gi=`#define MAX_TAPS ${an}
uniform int u_rad;
uniform int u_k[MAX_TAPS];
uniform int u_div;
uniform int u_scale;
void main() {
  // 契約の gpu.passes は入力（apron 込み）と同じ大きさで描く（実行器が内側だけを読み戻す）ので、出力画素 = 入力画素
  ivec2 p = og_pixel();
  vec4 s = vec4(0.0);
  int i = 0;
  for (int dy = -u_rad; dy <= u_rad; dy++) {
    for (int dx = -u_rad; dx <= u_rad; dx++) {
      s += float(u_k[i]) * og_i8(og_orig(p + ivec2(dx, dy)));
      i++;
    }
  }
  vec4 c = og_i8(og_orig(p));
  float d = float(u_div * u_scale);
  vec4 num = c * float(u_div * (u_scale - 1)) + s;
  vec4 o = clamp(floor((num + float((u_div * u_scale) / 2)) / d), 0.0, 255.0);
  o.rgb = min(o.rgb, vec3(o.a));
  fragColor = o / 255.0;
}
`,Xi=R({}).strict();function qi(t,e,n,o){const r=Jo(t.kernel),a=e.apronPx,i=tr(o),s=t.div*i,c=s/2,l=t.div*(i-1),u=t.kernel,f=e.w,m=e.h,d=(p,g,_)=>p<0||g<0||p>=f||g>=m?0:e.data[g*e.stride+p*4+_],h=[0,0,0,0];for(let p=0;p<n.h;p++)for(let g=0;g<n.w;g++){const _=g+a,y=p+a;for(let M=0;M<4;M++){let P=0;for(let I=-r,O=0;I<=r;I++)for(let $=-r;$<=r;$++,O++){const A=u[O];A!==0&&(P+=A*d(_+$,y+I,M))}const L=Math.floor((d(_,y,M)*l+P+c)/s);h[M]=L<0?0:L>255?255:L}const x=h[3],b=p*n.stride+g*4;n.data[b]=Math.min(h[0],x),n.data[b+1]=Math.min(h[1],x),n.data[b+2]=Math.min(h[2],x),n.data[b+3]=x}}function jt(t){const e=Jo(t.kernel);if(!Number.isInteger(e)||t.kernel.length>an)throw new RangeError(`filters: bad kernel for ${t.id}`);const n=new Int32Array(an);return n.set(t.kernel),{id:U(t.id),titleKey:Vt(t.titleKey),category:t.category,params:F(Xi),meta:[],apronPx:()=>e,apronAt:()=>e,gpu:{passes:[{frag:Gi}],uniforms:(o,r)=>({u_rad:e,u_k:n,u_div:t.div,u_scale:tr(r.level)})},cpu:(o,r,a,i)=>qi(t,o,a,i.level),previewStrategy:"proxy",recordable:!0}}const Ki=jt(Bi),Vi=jt(Ni),ji=jt(Wi),Yi=jt(Ui),Hi=jt(zi),er=2,nr=500,Qi=R({size:w().int().min(er).max(nr).default(10)}).strict(),Zi=(t,e)=>Math.floor(t/e),Yn=(t,e)=>Math.ceil(t/e)+0,Jt=(t,e,n)=>Zi((2*t+1)*(1<<n),2*e);function Hn(t,e,n){const o=1<<n;return[Yn(2*t*e-o,2*o),Yn(2*(t+1)*e-o,2*o)-1]}const Qn=(t,e)=>Math.max(0,Math.ceil(t/(1<<e))-1);function Ji(t,e,n,o){const r=o.level,a=e.size,i=t.apronPx,s=t.origin.x-i,c=t.origin.y-i,l=n.origin.x,u=n.origin.y,f=Jt(u,a,r),m=Jt(u+n.h-1,a,r),d=Jt(l,a,r),h=Jt(l+n.w-1,a,r);for(let p=f;p<=m;p++){const[g,_]=Hn(p,a,r);for(let y=d;y<=h;y++){const[x,b]=Hn(y,a,r);let M=0,P=0,L=0,I=0;for(let S=g;S<=_;S++){const D=S-c;if(!(D<0||D>=t.h))for(let X=x;X<=b;X++){const q=X-s;if(q<0||q>=t.w)continue;const T=D*t.stride+q*4;M+=t.data[T],P+=t.data[T+1],L+=t.data[T+2],I+=t.data[T+3]}}const O=(b-x+1)*(_-g+1),$=S=>Math.floor((2*S+O)/(2*O)),A=[$(M),$(P),$(L),$(I)],B=Math.max(g,u),W=Math.min(_,u+n.h-1),N=Math.max(x,l),V=Math.min(b,l+n.w-1);for(let S=B;S<=W;S++){let D=(S-u)*n.stride+(N-l)*4;for(let X=N;X<=V;X++,D+=4)n.data[D]=A[0],n.data[D+1]=A[1],n.data[D+2]=A[2],n.data[D+3]=A[3]}}}}const or=`uniform int u_size;
uniform int u_f;
uniform ivec2 u_o;
int og_floordiv(int a, int b) { return int(floor(float(a) / float(b))); }
int og_ceildiv(int a, int b) { return -og_floordiv(-a, b); }
int og_cell(int g) { return og_floordiv((2 * g + 1) * u_f, 2 * u_size); }
ivec2 og_range(int i) {
  return ivec2(og_ceildiv(2 * i * u_size - u_f, 2 * u_f), og_ceildiv(2 * (i + 1) * u_size - u_f, 2 * u_f) - 1);
}
`,rr=`${or}
void main() {
  ivec2 q = og_pixel();
  int g = u_o.x + q.x + u_apron;
  ivec2 r = og_range(og_cell(g));
  vec4 s = vec4(0.0);
  for (int x = r.x; x <= r.y; x++) s += og_i8(og_src(ivec2(x - u_o.x, q.y)));
  fragColor = s / (float(r.y - r.x + 1) * 255.0);
}
`,ar=`${or}
void main() {
  ivec2 q = og_pixel();
  int g = u_o.y + q.y + u_apron;
  ivec2 r = og_range(og_cell(g));
  vec4 s = vec4(0.0);
  for (int y = r.x; y <= r.y; y++) s += og_src(ivec2(q.x, y - u_o.y));
  fragColor = floor(s / float(r.y - r.x + 1) * 255.0 + 0.5) / 255.0;
}
`;function ts(t,e,n){const o=n.apron,r=n.w-2*o,a=n.h-2*o,i={u_size:t.size,u_f:1<<Math.max(0,e.level),u_o:[n.origin.x-o,n.origin.y-o]};return[{frag:rr,size:{w:r,h:n.h},precision:"float",uniforms:i},{frag:ar,size:{w:r,h:a},uniforms:i}]}const es=[{key:"size",categoryId:"correction",labelKey:v("param.pixelate.size"),type:"number",min:er,max:nr,step:1,unit:"px",display:"numeric",hasDynamics:!1,dynamicsAllowed:[]}],ns={id:_n.pixelate,titleKey:Vt("filters.filter.pixelate"),category:"effect",params:F(Qi),meta:es,apronPx:t=>Qn(t.size,0),apronAt:(t,e)=>Qn(t.size,e),gpu:{passes:[{frag:rr},{frag:ar}],uniforms:(t,e)=>({u_size:t.size,u_f:1<<Math.max(0,e.level),u_o:[e.rect.x,e.rect.y]})},gpuPlan:(t,e,n)=>ts(t,e,n),cpu:Ji,preservesTransparency:!0,previewStrategy:"proxy",recordable:!0},gt=(t,e)=>Math.min(255,Math.floor((510*t+e)/(2*e))),Ct=(t,e)=>Math.floor((2*t*e+255)/510);function ir(t,e,n=t){if(e.length<1024)throw new RangeError("filters: lut must be 256×4 bytes");const o=Math.min(t.length,n.length)>>2;for(let r=0;r<o;r++){const a=r*4,i=t[a+3];if(i===0){n[a]=n[a+1]=n[a+2]=n[a+3]=0;continue}const s=gt(t[a],i),c=gt(t[a+1],i),l=gt(t[a+2],i),u=e[i*4+3];n[a]=Ct(e[s*4],u),n[a+1]=Ct(e[c*4+1],u),n[a+2]=Ct(e[l*4+2],u),n[a+3]=u}}function Oe(t,e=t,n=t){const o=new Uint8Array(1024),r=a=>a<=0?0:a>=255?255:Math.floor(a+.5);for(let a=0;a<256;a++)o[a*4]=r(t(a)),o[a*4+1]=r(e(a)),o[a*4+2]=r(n(a)),o[a*4+3]=a;return o}function sr(t,e,n,o=t){const r=e.fn;if(!r)throw new Error(`filters: correction ${e.id} has no fn`);const a=Math.min(t.length,o.length)>>2,i=new Float32Array(a*3);for(let s=0;s<a;s++){const c=t[s*4+3];c!==0&&(i[s*3]=gt(t[s*4],c)/255,i[s*3+1]=gt(t[s*4+1],c)/255,i[s*3+2]=gt(t[s*4+2],c)/255)}r(i,n);for(let s=0;s<a;s++){const c=s*4,l=t[c+3];if(l===0){o[c]=o[c+1]=o[c+2]=o[c+3]=0;continue}for(let u=0;u<3;u++){const f=i[s*3+u],m=f<=0?0:f>=1?1:f;o[c+u]=Math.floor(m*l+.5)}o[c+3]=l}}function Gu(t,e,n,o=t){if(e.lut){ir(t,e.lut(n),o);return}sr(t,e,n,o)}const os=R({}).strict(),rs=(t,e,n)=>Math.floor((299*t+587*e+114*n+500)/1e3);function as(t,e,n,o){const r=t[e+3];if(r===0){n[o]=n[o+1]=n[o+2]=n[o+3]=0;return}const a=gt(t[e],r),i=gt(t[e+1],r),s=gt(t[e+2],r),c=255-rs(a,i,s),l=c<=0?0:Math.floor((2*r*c+255)/510);if(l===0){n[o]=n[o+1]=n[o+2]=n[o+3]=0;return}const u=f=>Math.max(0,255-Math.floor((2*(255-f)*255+c)/(2*c)));n[o]=Ct(u(a),l),n[o+1]=Ct(u(i),l),n[o+2]=Ct(u(s),l),n[o+3]=l}const is=`void main() {
  ivec2 p = og_pixel() + ivec2(u_apron);
  ivec4 c = ivec4(og_i8(og_orig(p)));
  if (c.a <= 0) { fragColor = vec4(0.0); return; }
  ivec3 s = min(ivec3(255), (510 * c.rgb + c.a) / (2 * c.a));
  int L = (299 * s.r + 587 * s.g + 114 * s.b + 500) / 1000;
  int den = 255 - L;
  if (den <= 0) { fragColor = vec4(0.0); return; }
  int na = (2 * c.a * den + 255) / 510;
  if (na <= 0) { fragColor = vec4(0.0); return; }
  ivec3 q = (2 * (255 - s) * 255 + den) / (2 * den);
  ivec3 cs = max(ivec3(0), ivec3(255) - q);
  ivec3 o = (2 * cs * na + 255) / 510;
  fragColor = vec4(vec3(o), float(na)) / 255.0;
}
`,ss={id:_n.brightnessToOpacity,titleKey:Vt("filters.filter.brightnessToOpacity"),category:"correction",params:F(os),meta:[],apronPx:()=>0,apronAt:()=>0,gpu:{passes:[{frag:is}],uniforms:()=>({})},cpu:(t,e,n)=>{const o=t.apronPx;for(let r=0;r<n.h;r++)for(let a=0;a<n.w;a++)as(t.data,(r+o)*t.stride+(a+o)*4,n.data,r*n.stride+a*4)},previewStrategy:"proxy",recordable:!0};function At(t){if(t.stride===t.w*4&&t.data.length===t.w*t.h*4)return new Uint8ClampedArray(t.data);const e=new Uint8ClampedArray(t.w*t.h*4);for(let n=0;n<t.h;n++)e.set(t.data.subarray(n*t.stride,n*t.stride+t.w*4),n*t.w*4);return e}function Zn(t,e,n,o,r){const a=new Uint8ClampedArray(t.length);if(o<=0)return a.set(t),a;const i=2*o+1,s=r==="h"?e:n,c=r==="h"?n:e,l=r==="h"?4:e*4;for(let u=0;u<c;u++){const f=r==="h"?u*e*4:u*4;for(let m=0;m<4;m++){let d=0;for(let h=0;h<=Math.min(o,s-1);h++)d+=t[f+h*l+m];for(let h=0;h<s;h++){a[f+h*l+m]=Math.floor((d+o)/i);const p=h+o+1,g=h-o;p<s&&(d+=t[f+p*l+m]),g>=0&&(d-=t[f+g*l+m])}}}return a}function Fe(t,e,n,o,r){let a=t;for(let i=0;i<r;i++)a=Zn(Zn(a,e,n,o,"h"),e,n,o,"v");return a}function cs(t){if(!(t>0))return 0;const e=Math.sqrt(4*t*t+1);return Math.max(1,Math.round((e-1)/2))}const Jn=`uniform int u_r;
uniform ivec2 u_axis;
void main() {
  ivec2 p = og_pixel();
  ivec4 s = ivec4(0);
  for (int i = -u_r; i <= u_r; i++) s += ivec4(og_i8(og_src(p + u_axis * i)));
  fragColor = vec4((s + u_r) / (2 * u_r + 1)) / 255.0;
}
`;function $e(t,e){const n=[];for(let o=0;o<e;o++)n.push({frag:Jn,precision:"rgba8",uniforms:{u_r:t,u_axis:[1,0]}}),n.push({frag:Jn,precision:"rgba8",uniforms:{u_r:t,u_axis:[0,1]}});return n}function _e(t,e){const n=255-t[e+3];return Math.floor((299*(t[e]+n)+587*(t[e+1]+n)+114*(t[e+2]+n)+500)/1e3)}const Be=`int og_lumaOverWhite(vec4 px) {
  ivec4 c = ivec4(og_i8(px));
  ivec3 w = c.rgb + (255 - c.a);
  return (299 * w.r + 587 * w.g + 114 * w.b + 500) / 1000;
}
`,sn=127;function ls(t,e,n,o){let r=new Int16Array(e*n*4),a=new Int16Array(e*n*4);const i=sn;for(let s=0;s<o;s++){for(let l=0;l<n;l++)for(let u=0;u<e;u++){const f=l*e+u;if(!t[f])continue;let m=r[f*4],d=r[f*4+1],h=r[f*4+2],p=r[f*4+3];for(let g=-1;g<=1;g++){const _=l+g;if(!(_<0||_>=n))for(let y=-1;y<=1;y++){if(y===0&&g===0)continue;const x=u+y;if(x<0||x>=e)continue;const b=_*e+x;if(!t[b])continue;const M=r[b*4]+y,P=r[b*4+1]+g,L=r[b*4+2]+y,I=r[b*4+3]+g;M<m&&(m=M),P<d&&(d=P),L>h&&(h=L),I>p&&(p=I)}}a[f*4]=Math.max(-i,m),a[f*4+1]=Math.max(-i,d),a[f*4+2]=Math.min(i,h),a[f*4+3]=Math.min(i,p)}const c=r;r=a,a=c}return r}const us=`void main() {
  ivec2 p = og_pixel();
  fragColor = og_member(p) ? vec4(128.0) / 255.0 : vec4(0.0);
}
`,fs=`void main() {
  ivec2 p = og_pixel();
  if (!og_member(p)) { fragColor = vec4(0.0); return; }
  ivec4 b = ivec4(og_i8(og_src(p))) - 128;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) continue;
      ivec2 q = p + ivec2(dx, dy);
      if (q.x < 0 || q.y < 0 || q.x >= u_srcSize.x || q.y >= u_srcSize.y || !og_member(q)) continue;
      ivec4 o = ivec4(og_i8(og_src(q))) - 128 + ivec4(dx, dy, dx, dy);
      b.xy = min(b.xy, o.xy);
      b.zw = max(b.zw, o.zw);
    }
  }
  b = clamp(b, ivec4(-${sn}), ivec4(${sn}));
  fragColor = vec4(b + 128) / 255.0;
}
`,cr=500,ms=128,lr=200,ur=64,it=256,St=128,wt=16,cn=(t,e,n,o,r,a={})=>({key:t,categoryId:"correction",labelKey:v(e),type:"number",min:n,max:o,step:r,display:"numeric",hasDynamics:!1,dynamicsAllowed:[],...a}),ve=(t,e,n)=>({key:t,categoryId:"correction",labelKey:v(e),type:"enum",options:n.map(o=>({value:o,labelKey:v(`${e}.${o}`)})),hasDynamics:!1,dynamicsAllowed:[]}),Ne=["flat","fade"],ds=(t,e)=>Math.floor(t/e),bt=(t,e)=>ds(2*t+e,2*e);function to(t,e,n,o){return o===0?bt(t*(2*e-n),2*n):bt(o===1?t*e:t*(e-n),n)}function hs(t,e,n,o){if(!o)return St;const r=n===0?Math.abs(2*t-e):n===1?t:e-t;return St-bt(9*St*r,10*e)}function gs(t,e,n,o,r,a,i){const s=o>>8,c=r>>8,l=o&255,u=r&255,f=256-l,m=256-u;let d=0,h=0,p=0,g=0;for(let _=0;_<4;_++){const y=s+(_&1),x=c+(_>>1),b=((_&1)===0?f:l)*(_>>1===0?m:u);if(b===0||y<0||x<0||y>=e||x>=n)continue;const M=(x*e+y)*4;d+=t[M]*b,h+=t[M+1]*b,p+=t[M+2]*b,g+=t[M+3]*b}i[0]=i[0]+(d+128>>8)*a,i[1]=i[1]+(h+128>>8)*a,i[2]=i[2]+(p+128>>8)*a,i[3]=i[3]+(g+128>>8)*a}function ps(t,e,n,o,r){const a=r*256,i=l=>{const u=Math.floor(l/a),f=u+(2*(l-u*a)>=a?1:0);return f<0?0:f>255?255:f},s=i(o[3]),c=n*t.stride+e*4;t.data[c]=Math.min(i(o[0]),s),t.data[c+1]=Math.min(i(o[1]),s),t.data[c+2]=Math.min(i(o[2]),s),t.data[c+3]=s}function fr(t,e,n,o,r,a,i,s,c,l,u,f,m,d){u.fill(0);let h=0;const p=o*it,g=r*it;for(let _=0;_<=s;_++){const y=hs(_,s,c,l);gs(t,e,n,p+to(a,_,s,c),g+to(i,_,s,c),y,u),h+=y}ps(f,m,d,u,h)}const mr=`int og_floorDiv(int a, int b) { return a >= 0 ? a / b : -((b - 1 - a) / b); }
int og_roundDiv(int a, int b) { return og_floorDiv(2 * a + b, 2 * b); }
ivec4 og_tap(ivec2 q) {
  ivec2 i = q >> 8;
  ivec2 t = q & 255;
  ivec2 u = 256 - t;
  ivec4 a = ivec4(og_i8(og_orig(i)));
  ivec4 b = ivec4(og_i8(og_orig(i + ivec2(1, 0))));
  ivec4 c = ivec4(og_i8(og_orig(i + ivec2(0, 1))));
  ivec4 d = ivec4(og_i8(og_orig(i + ivec2(1, 1))));
  ivec4 s = a * (u.x * u.y) + b * (t.x * u.y) + c * (u.x * t.y) + d * (t.x * t.y);
  return (s + 128) >> 8;
}
int og_lineOffset(int e, int j, int n, int mode) {
  return mode == 0 ? og_roundDiv(e * (2 * j - n), 2 * n) : (mode == 1 ? og_roundDiv(e * j, n) : og_roundDiv(e * (j - n), n));
}
int og_lineWeight(int j, int n, int mode, int fade) {
  if (fade == 0) return ${St};
  int k = mode == 0 ? abs(2 * j - n) : (mode == 1 ? j : n - j);
  return ${St} - og_roundDiv(${9*St} * k, 10 * n);
}
void og_writeFixed(ivec4 acc, int wsum) {
  int den = wsum * 256;
  ivec4 q = acc / den;
  ivec4 r = acc - q * den;
  ivec4 o = q + ivec4(greaterThanEqual(2 * r, ivec4(den)));
  o = clamp(o, 0, 255);
  o.rgb = min(o.rgb, ivec3(o.a));
  fragColor = vec4(o) / 255.0;
}
void og_line(ivec2 p, ivec2 e, int n, int mode, int fade) {
  ivec4 acc = ivec4(0);
  int wsum = 0;
  ivec2 base = p * ${it};
  for (int j = 0; j <= n; j++) {
    int w = og_lineWeight(j, n, mode, fade);
    ivec2 off = ivec2(og_lineOffset(e.x, j, n, mode), og_lineOffset(e.y, j, n, mode));
    acc += og_tap(base + off) * w;
    wsum += w;
  }
  og_writeFixed(acc, wsum);
}
`,dr=["both","forward","backward"],ys=R({distance:w().min(0).max(cr).default(20),angle:w().min(-180).max(180).default(0),direction:Q(dr).default("both"),falloff:Q(Ne).default("flat")}).strict();function We(t,e){const n=t.distance/(1<<Math.max(0,e)),[o,r]=t.direction==="forward"?[0,n]:t.direction==="backward"?[-n,0]:[-n/2,n/2];return{len:n,start:o,end:r,n:Math.min(ms,Math.max(1,Math.ceil(n)))}}const _s=t=>{const e=t*Math.PI/180;return[Math.cos(e),-Math.sin(e)]};function hr(t,e){const n=We(t,e),[o,r]=_s(t.angle);return{e:[Math.round(o*n.len*it),Math.round(r*n.len*it)],mode:t.direction==="forward"?1:t.direction==="backward"?2:0,n:n.n}}const eo=(t,e)=>{const n=We(t,e);return n.len<.5?0:Math.ceil(Math.max(Math.abs(n.start),Math.abs(n.end)))+2};function vs(t,e,n,o){const r=t.apronPx,a=At(t);if(We(e,o.level).len<.5){for(let m=0;m<n.h;m++){const d=((m+r)*t.w+r)*4;n.data.set(a.subarray(d,d+n.w*4),m*n.stride)}return}const{e:s,mode:c,n:l}=hr(e,o.level),u=e.falloff==="fade",f=new Int32Array(4);for(let m=0;m<n.h;m++)for(let d=0;d<n.w;d++)fr(a,t.w,t.h,d+r,m+r,s[0],s[1],l,c,u,f,n,d,m)}const no=`${mr}
uniform ivec2 u_e;
uniform int u_mode;
uniform int u_n;
uniform int u_fade;
void main() {
  og_line(og_pixel(), u_e, u_n, u_mode, u_fade);
}
`,xs=`void main() { fragColor = og_orig(og_pixel()); }
`,oo=(t,e)=>{const n=hr(t,e);return{u_e:n.e,u_mode:n.mode,u_n:n.n,u_fade:t.falloff==="fade"?1:0}},ws={id:U("filters.motionBlur"),titleKey:v("filter.motionBlur"),category:"blur",params:F(ys),meta:[cn("distance","param.motionBlur.distance",0,cr,1,{unit:"px"}),cn("angle","param.motionBlur.angle",-180,180,1,{unit:"deg"}),ve("direction","param.motionBlur.direction",dr),ve("falloff","param.blur.falloff",Ne)],apronPx:t=>eo(t,0),apronAt:(t,e)=>eo(t,e),gpu:{passes:[{frag:no}],uniforms:(t,e)=>oo(t,e.level)},gpuPlan:(t,e)=>We(t,e.level).len<.5?[{frag:xs}]:[{frag:no,uniforms:oo(t,e.level)}],cpu:vs,previewStrategy:"proxy",recordable:!0},gr=["both","inward","outward"],bs=R({amount:w().min(0).max(100).default(10),direction:Q(gr).default("both"),falloff:Q(Ne).default("flat"),centerX:w().min(-1e5).max(1e5).nullable().default(null),centerY:w().min(-1e5).max(1e5).nullable().default(null)}).strict(),ro=(t,e)=>t.amount<=0?0:Math.ceil(lr/(1<<Math.max(0,e)))+2;function pr(t,e){const n=1<<Math.max(0,e.level),o=e.point??{x:0,y:0};return{cx:Math.round(o.x*wt/n),cy:Math.round(o.y*wt/n),amount16:Math.round(Math.min(100,Math.max(0,t.amount))*16),maxLen:Math.round(lr*it/n),mode:t.direction==="outward"?1:t.direction==="inward"?2:0}}function Ms(t){let e=Math.floor(Math.sqrt(t));for(;e*e>t;)e--;for(;(e+1)*(e+1)<=t;)e++;return e}function As(t,e,n){let o=Math.abs(t),r=Math.abs(e),a=Math.max(o,r);if(a===0||n.amount16<=0)return null;let i=0;for(;a<4096;)a*=2,i++;for(;a>=8192;)a>>=1,i--;i>=0?(o<<=i,r<<=i):(o>>=-i,r>>=-i);const s=Ms(o*o+r*r),c=s*n.amount16;let l;if(i>=0)l=bt(c,100<<i);else{const d=-i,h=100*n.maxLen+(1<<d)-1>>d;l=c>=h?n.maxLen:bt(c<<d,100)}if(l>n.maxLen&&(l=n.maxLen),l<it/2)return null;const u=Math.min(ur,Math.max(1,l+it-1>>8)),f=bt(o*l,s),m=bt(r*l,s);return{ex:t<0?-f:f,ey:e<0?-m:m,n:u}}function ks(t,e,n,o){const r=t.apronPx,a=At(t),i=pr(e,o),s=e.falloff==="fade",c=new Int32Array(4);for(let l=0;l<n.h;l++)for(let u=0;u<n.w;u++){const f=wt*(t.origin.x+u)+wt/2-i.cx,m=wt*(t.origin.y+l)+wt/2-i.cy,d=As(f,m,i);if(!d){const h=((l+r)*t.w+u+r)*4,p=l*n.stride+u*4;n.data[p]=a[h],n.data[p+1]=a[h+1],n.data[p+2]=a[h+2],n.data[p+3]=a[h+3];continue}fr(a,t.w,t.h,u+r,l+r,d.ex,d.ey,d.n,i.mode,s,c,n,u,l)}}const ao=`${mr}
uniform ivec2 u_center;
uniform ivec2 u_origin;
uniform int u_amount16;
uniform int u_maxLen;
uniform int u_mode;
uniform int u_fade;
void main() {
  ivec2 p = og_pixel();
  ivec2 v = ${wt} * (u_origin + p - ivec2(u_apron)) + ${wt/2} - u_center;
  int ax = abs(v.x);
  int ay = abs(v.y);
  int m = max(ax, ay);
  if (m == 0 || u_amount16 <= 0) {
    fragColor = og_orig(p);
    return;
  }
  int e = 0;
  for (int i = 0; i < 13; i++) {
    if (m < 4096) {
      m *= 2;
      e++;
    }
  }
  for (int i = 0; i < 20; i++) {
    if (m >= 8192) {
      m >>= 1;
      e--;
    }
  }
  if (e >= 0) {
    ax <<= e;
    ay <<= e;
  } else {
    ax >>= -e;
    ay >>= -e;
  }
  int D = ax * ax + ay * ay;
  int d = int(sqrt(float(D)));
  for (int i = 0; i < 3; i++) if (d * d > D) d--;
  for (int i = 0; i < 3; i++) if ((d + 1) * (d + 1) <= D) d++;
  int prod = d * u_amount16;
  int len;
  if (e >= 0) len = og_roundDiv(prod, 100 << e);
  else {
    int s = -e;
    int t = (100 * u_maxLen + (1 << s) - 1) >> s;
    len = prod >= t ? u_maxLen : og_roundDiv(prod << s, 100);
  }
  len = min(len, u_maxLen);
  if (len < ${it/2}) {
    fragColor = og_orig(p);
    return;
  }
  int n = min(${ur}, max(1, (len + ${it-1}) >> 8));
  int ex = og_roundDiv(ax * len, d);
  int ey = og_roundDiv(ay * len, d);
  og_line(p, ivec2(v.x < 0 ? -ex : ex, v.y < 0 ? -ey : ey), n, u_mode, u_fade);
}
`,io=(t,e,n)=>{const o=pr(t,e);return{u_center:[o.cx,o.cy],u_origin:[n.x,n.y],u_amount16:o.amount16,u_maxLen:o.maxLen,u_mode:o.mode,u_fade:t.falloff==="fade"?1:0}},Es={id:U("filters.radialBlur"),titleKey:v("filter.radialBlur"),category:"blur",params:F(bs),meta:[cn("amount","param.radialBlur.amount",0,100,1,{unit:"percent"}),ve("direction","param.radialBlur.direction",gr),ve("falloff","param.blur.falloff",Ne)],pickPoint:!0,resolvePoint:(t,e)=>({x:t.centerX??e.w/2,y:t.centerY??e.h/2}),apronPx:t=>ro(t,0),apronAt:(t,e)=>ro(t,e),gpu:{passes:[{frag:ao}],uniforms:(t,e)=>io(t,e,{x:e.rect.x,y:e.rect.y})},gpuPlan:(t,e,n)=>[{frag:ao,uniforms:io(t,e,n.origin)}],cpu:ks,previewStrategy:"proxy",recordable:!0},yr=100,Ts=R({radius:w().min(.5).max(yr).default(3),amount:w().int().min(1).max(500).default(100),threshold:w().int().min(0).max(255).default(0)}).strict(),xe=(t,e)=>cs(t.radius/(1<<Math.max(0,e)));function so(t,e,n,o){const r=t-e,a=Math.abs(r);if(a<o||a===0)return t;const i=Math.floor((a*n+50)/100),s=r>0?t+i:t-i;return s<0?0:s>255?255:s}function Ps(t,e,n,o){const r=t.apronPx,a=At(t),i=xe(e,o.level),s=Fe(a,t.w,t.h,i,3);for(let c=0;c<n.h;c++)for(let l=0;l<n.w;l++){const u=((c+r)*t.w+l+r)*4,f=c*n.stride+l*4,m=so(a[u+3],s[u+3],e.amount,e.threshold);for(let d=0;d<3;d++)n.data[f+d]=Math.min(m,so(a[u+d],s[u+d],e.amount,e.threshold));n.data[f+3]=m}}const _r=`uniform int u_amount;
uniform int u_threshold;
void main() {
  ivec2 p = og_pixel();
  ivec4 c = ivec4(og_i8(og_orig(p)));
  ivec4 b = ivec4(og_i8(og_src(p)));
  ivec4 d = c - b;
  ivec4 m = abs(d);
  ivec4 q = (m * u_amount + 50) / 100;
  ivec4 o = c + sign(d) * q;
  bvec4 keep = bvec4(m.x < u_threshold || m.x == 0, m.y < u_threshold || m.y == 0, m.z < u_threshold || m.z == 0, m.w < u_threshold || m.w == 0);
  o = ivec4(mix(vec4(clamp(o, 0, 255)), vec4(c), vec4(keep)));
  o.rgb = min(o.rgb, ivec3(o.a));
  fragColor = vec4(o) / 255.0;
}
`,Rs=[{key:"radius",categoryId:"correction",labelKey:v("param.unsharp.radius"),type:"number",min:.5,max:yr,step:.1,unit:"px",display:"numeric",hasDynamics:!1,dynamicsAllowed:[]},{key:"amount",categoryId:"correction",labelKey:v("param.unsharp.amount"),type:"number",min:1,max:500,step:1,unit:"percent",display:"numeric",hasDynamics:!1,dynamicsAllowed:[]},{key:"threshold",categoryId:"correction",labelKey:v("param.unsharp.threshold"),type:"number",min:0,max:255,step:1,display:"numeric",hasDynamics:!1,dynamicsAllowed:[]}];function Ls(t,e){const n=xe(t,e.level);return[...$e(n,3),{frag:_r,uniforms:{u_amount:t.amount,u_threshold:t.threshold}}]}const Is={id:U("filters.unsharpMask"),titleKey:v("filter.unsharpMask"),category:"sharpen",params:F(Ts),meta:Rs,apronPx:t=>3*xe(t,0),apronAt:(t,e)=>3*xe(t,e),gpu:{passes:[{frag:_r}],uniforms:t=>({u_amount:t.amount,u_threshold:t.threshold})},gpuPlan:(t,e)=>Ls(t,e),cpu:Ps,previewStrategy:"proxy",recordable:!0},Cs=R({scale:w().min(1).max(2e3).default(100),amplitude:w().min(0).max(100).default(100),attenuation:w().min(0).max(100).default(50),octaves:w().int().min(1).max(8).default(4),offsetX:w().min(-1e4).max(1e4).default(0),offsetY:w().min(-1e4).max(1e4).default(0),seed:w().int().min(0).max(65535).default(0)}).strict(),we=1<<22,mt=Math.SQRT1_2,Ss=[[1,0],[-1,0],[0,1],[0,-1],[mt,mt],[-mt,mt],[mt,-mt],[-mt,-mt]];function vr(t,e,n){let o=(Math.imul(t+we>>>0,2376512323)^Math.imul(e+we>>>0,3625334849)^Math.imul(n>>>0,3407524639))>>>0;return o=(o^o>>>13)>>>0,o=Math.imul(o,2246822507)>>>0,o=(o^o>>>16)>>>0,o}const co=t=>t*t*t*(t*(t*6-15)+10);function Ds(t,e,n){const o=Math.floor(t),r=Math.floor(e),a=t-o,i=e-r,s=(g,_,y,x)=>{const b=Ss[vr(g,_,n)&7];return b[0]*y+b[1]*x},c=s(o,r,a,i),l=s(o+1,r,a-1,i),u=s(o,r+1,a,i-1),f=s(o+1,r+1,a-1,i-1),m=co(a),d=co(i),h=c+(l-c)*m,p=u+(f-u)*m;return h+(p-h)*d}function Os(t,e,n){let o=0,r=0,a=1,i=1/t.scale;for(let u=0;u<t.octaves;u++)o+=a*Ds((e+t.offsetX)*i,(n+t.offsetY)*i,t.seed+u),r+=a,a*=t.attenuation/100,i*=2;const c=.5+(r>0?o/r:0)*(t.amplitude/100)*1.5;return Math.floor((c<0?0:c>1?1:c)*255+.5)}function Fs(t,e,n,o){const r=1<<Math.max(0,o.level);for(let a=0;a<n.h;a++){const i=(t.origin.y+a+.5)*r-.5;for(let s=0;s<n.w;s++){const c=(t.origin.x+s+.5)*r-.5,l=Os(e,c,i),u=a*n.stride+s*4;n.data[u]=l,n.data[u+1]=l,n.data[u+2]=l,n.data[u+3]=255}}}const lo=`uniform vec2 u_origin;
uniform float u_f;
uniform float u_scale;
uniform float u_amp;
uniform float u_att;
uniform int u_octaves;
uniform vec2 u_offset;
uniform int u_seed;
uint og_hash(int ix, int iy, int seed) {
  uint h = (uint(ix + ${we}) * 0x8da6b343u) ^ (uint(iy + ${we}) * 0xd8163841u) ^ (uint(seed) * 0xcb1ab31fu);
  h ^= h >> 13u;
  h *= 0x85ebca6bu;
  h ^= h >> 16u;
  return h;
}
vec2 og_grad(uint h) {
  int k = int(h & 7u);
  float s = ${mt.toFixed(9)};
  if (k == 0) return vec2(1.0, 0.0);
  if (k == 1) return vec2(-1.0, 0.0);
  if (k == 2) return vec2(0.0, 1.0);
  if (k == 3) return vec2(0.0, -1.0);
  if (k == 4) return vec2(s, s);
  if (k == 5) return vec2(-s, s);
  if (k == 6) return vec2(s, -s);
  return vec2(-s, -s);
}
float og_fade(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
float og_perlin(vec2 q, int seed) {
  vec2 fl = floor(q);
  ivec2 i = ivec2(fl);
  vec2 f = q - fl;
  float n00 = dot(og_grad(og_hash(i.x, i.y, seed)), f);
  float n10 = dot(og_grad(og_hash(i.x + 1, i.y, seed)), f - vec2(1.0, 0.0));
  float n01 = dot(og_grad(og_hash(i.x, i.y + 1, seed)), f - vec2(0.0, 1.0));
  float n11 = dot(og_grad(og_hash(i.x + 1, i.y + 1, seed)), f - vec2(1.0, 1.0));
  float u = og_fade(f.x);
  float v = og_fade(f.y);
  float a = n00 + (n10 - n00) * u;
  float b = n01 + (n11 - n01) * u;
  return a + (b - a) * v;
}
void main() {
  ivec2 p = og_pixel();
  vec2 c = (u_origin + vec2(p) + 0.5) * u_f - 0.5;
  float sum = 0.0;
  float norm = 0.0;
  float amp = 1.0;
  float freq = 1.0 / u_scale;
  for (int o = 0; o < u_octaves; o++) {
    sum += amp * og_perlin((c + u_offset) * freq, u_seed + o);
    norm += amp;
    amp *= u_att / 100.0;
    freq *= 2.0;
  }
  float n = norm > 0.0 ? sum / norm : 0.0;
  float g = clamp(0.5 + n * (u_amp / 100.0) * 1.5, 0.0, 1.0);
  fragColor = vec4(vec3(floor(g * 255.0 + 0.5)), 255.0) / 255.0;
}
`,kt=(t,e,n,o,r,a={})=>({key:t,categoryId:"correction",labelKey:v(e),type:"number",min:n,max:o,step:r,display:"numeric",hasDynamics:!1,dynamicsAllowed:[],...a}),uo=(t,e,n)=>({u_origin:[n.x,n.y],u_f:1<<Math.max(0,e.level),u_scale:t.scale,u_amp:t.amplitude,u_att:t.attenuation,u_octaves:t.octaves,u_offset:[t.offsetX,t.offsetY],u_seed:t.seed}),$s={id:U("filters.perlinNoise"),titleKey:v("filter.perlinNoise"),category:"render",params:F(Cs),meta:[kt("scale","param.perlin.scale",1,2e3,1,{unit:"px",log:!0}),kt("amplitude","param.perlin.amplitude",0,100,1,{unit:"percent"}),kt("attenuation","param.perlin.attenuation",0,100,1,{unit:"percent"}),kt("octaves","param.perlin.octaves",1,8,1),kt("offsetX","param.perlin.offsetX",-1e4,1e4,1,{unit:"px"}),kt("offsetY","param.perlin.offsetY",-1e4,1e4,1,{unit:"px"}),kt("seed","param.perlin.seed",0,65535,1)],apronPx:()=>0,apronAt:()=>0,gpu:{passes:[{frag:lo}],uniforms:(t,e)=>uo(t,e,{x:e.rect.x,y:e.rect.y})},gpuPlan:(t,e,n)=>[{frag:lo,uniforms:uo(t,e,n.origin)}],cpu:Fs,previewStrategy:"proxy",recordable:!0},se=(t,e,n,o,r,a={})=>({key:t,categoryId:"correction",labelKey:v(e),type:"number",min:n,max:o,step:r,display:"numeric",hasDynamics:!1,dynamicsAllowed:[],...a}),xr=(t,e)=>Math.round(t/(1<<Math.max(0,e))),wr=50,be=32,Bs=R({blur:w().int().min(1).max(wr).default(4),edgeThreshold:w().int().min(0).max(255).default(12),fillBlack:Dt().default(!1),blackThreshold:w().int().min(0).max(254).default(64)}).strict();function Ns(t,e,n){if(n.fillBlack&&t<=n.blackThreshold)return 255;const o=e-t-n.edgeThreshold+1;return o<=0?0:Math.min(255,Math.floor((o*255+be/2)/be))}const Me=(t,e)=>xr(t.blur,e);function Ws(t,e,n,o){const r=t.apronPx,a=At(t),i=t.w*t.h,s=new Uint8ClampedArray(i*4);for(let u=0;u<i;u++){const f=_e(a,u*4);s[u*4]=s[u*4+1]=s[u*4+2]=f,s[u*4+3]=255}const c=Me(e,o.level),l=c>0?Fe(s,t.w,t.h,c,2):s;for(let u=0;u<n.h;u++)for(let f=0;f<n.w;f++){const m=((u+r)*t.w+f+r)*4,d=Ns(_e(a,m),l[m],e),h=u*n.stride+f*4;n.data[h]=0,n.data[h+1]=0,n.data[h+2]=0,n.data[h+3]=d}}const Us=`${Be}
void main() {
  int y = og_lumaOverWhite(og_orig(og_pixel()));
  fragColor = vec4(vec3(float(y)), 255.0) / 255.0;
}
`,br=`${Be}
uniform int u_edge;
uniform int u_fillBlack;
uniform int u_black;
void main() {
  ivec2 p = og_pixel();
  int y = og_lumaOverWhite(og_orig(p));
  int b = int(og_i8(og_src(p)).r);
  int a = 0;
  if (u_fillBlack != 0 && y <= u_black) a = 255;
  else {
    int s = b - y - u_edge + 1;
    if (s > 0) a = min(255, (s * 255 + ${be/2}) / ${be});
  }
  fragColor = vec4(0.0, 0.0, 0.0, float(a) / 255.0);
}
`,Mr=t=>({u_edge:t.edgeThreshold,u_fillBlack:t.fillBlack?1:0,u_black:t.blackThreshold});function zs(t,e){const n=Me(t,e.level);return[{frag:Us,precision:"rgba8"},...n>0?$e(n,2):[],{frag:br,uniforms:Mr(t)}]}const Gs={id:U("filters.lineExtraction"),titleKey:v("filter.lineExtraction"),category:"lineart",params:F(Bs),meta:[se("blur","param.lineExtraction.blur",1,wr,1,{unit:"px"}),se("edgeThreshold","param.lineExtraction.edgeThreshold",0,255,1),{key:"fillBlack",categoryId:"correction",labelKey:v("param.lineExtraction.fillBlack"),type:"boolean",hasDynamics:!1,dynamicsAllowed:[]},se("blackThreshold","param.lineExtraction.blackThreshold",0,254,1,{visibleWhen:t=>t.settings?.fillBlack===!0})],preservesTransparency:!0,apronPx:t=>2*Me(t,0),apronAt:(t,e)=>2*Me(t,e),gpu:{passes:[{frag:br}],uniforms:t=>Mr(t)},gpuPlan:(t,e)=>zs(t,e),cpu:Ws,previewStrategy:"proxy",recordable:!0},Ar=100,kr=["transparent","white"],Er=252,Xs=R({size:w().int().min(1).max(Ar).default(4),mode:Q(kr).default("transparent")}).strict(),Ae=(t,e)=>Math.max(1,xr(t.size,e));function qs(t,e,n){return n==="transparent"?t[e+3]>0:_e(t,e)<=Er}function Ks(t,e,n,o){const r=t.apronPx,a=At(t),i=t.w*t.h,s=Ae(e,o.level),c=new Uint8Array(i);for(let u=0;u<i;u++)c[u]=qs(a,u*4,e.mode)?1:0;const l=ls(c,t.w,t.h,s);for(let u=0;u<n.h;u++)for(let f=0;f<n.w;f++){const m=(u+r)*t.w+f+r,d=u*n.stride+f*4;if(c[m]===1&&l[m*4+2]-l[m*4]+1<=s&&l[m*4+3]-l[m*4+1]+1<=s){const p=e.mode==="white"?255:0;n.data[d]=n.data[d+1]=n.data[d+2]=n.data[d+3]=p}else n.data.set(a.subarray(m*4,m*4+4),d)}}const ln=`${Be}
uniform int u_mode;
bool og_member(ivec2 q) {
  vec4 c = og_orig(q);
  return u_mode == 0 ? og_i8(c).a > 0.0 : og_lumaOverWhite(c) <= ${Er};
}
`,Tr=`${ln}
uniform int u_size;
void main() {
  ivec2 p = og_pixel();
  vec4 c = og_orig(p);
  if (og_member(p)) {
    ivec4 b = ivec4(og_i8(og_src(p))) - 128;
    if (b.z - b.x + 1 <= u_size && b.w - b.y + 1 <= u_size) {
      fragColor = u_mode == 0 ? vec4(0.0) : vec4(1.0);
      return;
    }
  }
  fragColor = c;
}
`;function Vs(t,e){const n=Ae(t,e.level),o={u_mode:t.mode==="transparent"?0:1,u_size:n};return[{frag:`${ln}${us}`,precision:"rgba8",uniforms:o},{frag:`${ln}${fs}`,precision:"rgba8",iterations:n,uniforms:o},{frag:Tr,uniforms:o}]}const js={id:U("filters.removeDust"),titleKey:v("filter.removeDust"),category:"lineart",params:F(Xs),meta:[se("size","param.removeDust.size",1,Ar,1,{unit:"px"}),{key:"mode",categoryId:"correction",labelKey:v("param.removeDust.mode"),type:"enum",options:kr.map(t=>({value:t,labelKey:v(`param.removeDust.mode.${t}`)})),hasDynamics:!1,dynamicsAllowed:[]}],preservesTransparency:!0,apronPx:t=>Ae(t,0),apronAt:(t,e)=>Ae(t,e),gpu:{passes:[{frag:Tr}],uniforms:t=>({u_mode:t.mode==="transparent"?0:1,u_size:t.size})},gpuPlan:(t,e)=>Vs(t,e),cpu:Ks,previewStrategy:"proxy",recordable:!0},Z=(t,e,n,o,r,a={})=>({key:t,categoryId:"correction",labelKey:v(e),type:"number",min:n,max:o,step:r,display:"numeric",hasDynamics:!1,dynamicsAllowed:[],...a}),Ys=R({brightness:w().int().min(-100).max(100).default(0),contrast:w().int().min(-100).max(100).default(0)}).strict();function Hs(t,e){const n=e.contrast>=0?1/(1-.99*e.contrast/100):1+e.contrast/100;return(t+1.275*e.brightness-127.5)*n+127.5}const Pr={id:st.brightnessContrast,titleKey:v("correction.brightnessContrast"),params:F(Ys),meta:[Z("brightness","param.brightness",-100,100,1),Z("contrast","param.contrast",-100,100,1)],lut:t=>Oe(e=>Hs(e,t))},G={inBlack:w().int().min(0).max(254).default(0),inWhite:w().int().min(1).max(255).default(255),gamma:w().min(.1).max(9.99).default(1),outBlack:w().int().min(0).max(255).default(0),outWhite:w().int().min(0).max(255).default(255)},un=["rgb","r","g","b"],Qs=R({channel:Q(un).default("rgb"),rgbInBlack:G.inBlack,rgbInWhite:G.inWhite,rgbGamma:G.gamma,rgbOutBlack:G.outBlack,rgbOutWhite:G.outWhite,rInBlack:G.inBlack,rInWhite:G.inWhite,rGamma:G.gamma,rOutBlack:G.outBlack,rOutWhite:G.outWhite,gInBlack:G.inBlack,gInWhite:G.inWhite,gGamma:G.gamma,gOutBlack:G.outBlack,gOutWhite:G.outWhite,bInBlack:G.inBlack,bInWhite:G.inWhite,bGamma:G.gamma,bOutBlack:G.outBlack,bOutWhite:G.outWhite}).strict();function Zs(t,e,n,o,r,a){const i=Math.max(n,e+1);let s=(t-e)/(i-e);return s=s<=0?0:s>=1?1:s,s=Math.pow(s,1/o),r+s*(a-r)}const fo=(t,e,n)=>Zs(n,t[`${e}InBlack`],t[`${e}InWhite`],t[`${e}Gamma`],t[`${e}OutBlack`],t[`${e}OutWhite`]);function Ve(t,e,n){const o=Math.min(255,Math.max(0,Math.floor(fo(t,e,n)+.5)));return fo(t,"rgb",o)}const Js=()=>{const t=[{key:"channel",categoryId:"correction",labelKey:v("param.levels.channel"),type:"enum",options:un.map(e=>({value:e,labelKey:v(`param.levels.channel.${e}`)})),hasDynamics:!1,dynamicsAllowed:[]}];for(const e of un){const n=o=>(o.settings?.channel??"rgb")===e;t.push(Z(`${e}InBlack`,"param.levels.inBlack",0,254,1,{visibleWhen:n}),Z(`${e}InWhite`,"param.levels.inWhite",1,255,1,{visibleWhen:n}),Z(`${e}Gamma`,"param.levels.gamma",.1,9.99,.01,{visibleWhen:n}),Z(`${e}OutBlack`,"param.levels.outBlack",0,255,1,{visibleWhen:n}),Z(`${e}OutWhite`,"param.levels.outWhite",0,255,1,{visibleWhen:n}))}return t},Rr={id:st.levels,titleKey:v("correction.levels"),params:F(Qs),meta:Js(),lut:t=>Oe(e=>Ve(t,"r",e),e=>Ve(t,"g",e),e=>Ve(t,"b",e))},tc=R({hue:w().int().min(-180).max(180).default(0),saturation:w().int().min(-100).max(100).default(0),luminosity:w().int().min(-100).max(100).default(0)}).strict();function ec(t,e,n,o){const r=Math.max(t,e,n),a=Math.min(t,e,n);let i=(r+a)/2;const s=r-a;let c=0,l=0;if(s>1e-7&&(l=i>.5?s/(2-r-a):s/(r+a),r===t?c=(e-n)/s+(e<n?6:0):r===e?c=(n-t)/s+2:c=(t-e)/s+4,c/=6),c=c+o.hue/360,c=c-Math.floor(c),l=Math.min(1,Math.max(0,l*(1+o.saturation/100))),i=o.luminosity>=0?i+(1-i)*(o.luminosity/100):i*(1+o.luminosity/100),l<=0)return[i,i,i];const u=i<.5?i*(1+l):i+l-i*l,f=2*i-u,m=d=>{let h=d;return h<0&&(h+=1),h>1&&(h-=1),h<1/6?f+(u-f)*6*h:h<1/2?u:h<2/3?f+(u-f)*(2/3-h)*6:f};return[m(c+1/3),m(c),m(c-1/3)]}const nc=`uniform float u_hue;
uniform float u_sat;
uniform float u_lum;
float og_hue2(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 og_correction(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  float h = 0.0;
  float s = 0.0;
  if (d > 1e-7) {
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  h = h + u_hue / 360.0;
  h = h - floor(h);
  s = clamp(s * (1.0 + u_sat / 100.0), 0.0, 1.0);
  l = u_lum >= 0.0 ? l + (1.0 - l) * (u_lum / 100.0) : l * (1.0 + u_lum / 100.0);
  if (s <= 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(og_hue2(p, q, h + 1.0 / 3.0), og_hue2(p, q, h), og_hue2(p, q, h - 1.0 / 3.0));
}
`,Lr={id:st.hsl,titleKey:v("correction.hsl"),params:F(tc),meta:[Z("hue","param.hue",-180,180,1,{unit:"deg"}),Z("saturation","param.saturation",-100,100,1),Z("luminosity","param.luminosity",-100,100,1)],fn:(t,e)=>{for(let n=0;n+2<t.length;n+=3){const[o,r,a]=ec(t[n],t[n+1],t[n+2],e);t[n]=o,t[n+1]=r,t[n+2]=a}},glsl:nc,uniforms:t=>({u_hue:t.hue,u_sat:t.saturation,u_lum:t.luminosity})},oc=R({}).strict(),Ir={id:st.invert,titleKey:v("correction.invert"),params:F(oc),meta:[],lut:()=>Oe(t=>255-t)},Cr=2,Sr=20,rc=R({levels:w().int().min(Cr).max(Sr).default(4)}).strict();function ac(t,e){return Math.min(e-1,Math.floor(t*e/256))*255/(e-1)}const Dr={id:st.posterize,titleKey:v("correction.posterize"),params:F(rc),meta:[Z("levels","param.posterize.levels",Cr,Sr,1)],lut:t=>Oe(e=>ac(e,t.levels))},ic=R({threshold:w().int().min(1).max(255).default(128)}).strict(),Or=(t,e,n)=>Math.floor((299*t+587*e+114*n+500)/1e3),sc=`uniform int u_threshold;
vec3 og_correction(vec3 c) {
  ivec3 v = ivec3(floor(c * 255.0 + 0.5));
  int l = (299 * v.r + 587 * v.g + 114 * v.b + 500) / 1000;
  return l >= u_threshold ? vec3(1.0) : vec3(0.0);
}
`,Fr={id:st.binarize,titleKey:v("correction.binarize"),params:F(ic),meta:[Z("threshold","param.binarize.threshold",1,255,1)],fn:(t,e)=>{for(let n=0;n+2<t.length;n+=3){const r=Or(Math.round(t[n]*255),Math.round(t[n+1]*255),Math.round(t[n+2]*255))>=e.threshold?1:0;t[n]=r,t[n+1]=r,t[n+2]=r}},glsl:sc,uniforms:t=>({u_threshold:t.threshold})},cc=[Pr,Rr,Lr,Ir,Dr,Fr],xn=Object.freeze([{x:0,y:0},{x:1,y:1}]),nt=t=>t<0?0:t>1?1:t;function $r(t){const e=t.map((o,r)=>({p:{x:nt(o.x),y:nt(o.y)},i:r})).sort((o,r)=>o.p.x-r.p.x||o.i-r.i).map(o=>o.p),n=[];for(const o of e){const r=n[n.length-1];r&&Math.abs(r.x-o.x)<1e-9?n[n.length-1]=o:n.push(o)}return n}function Br(t,e){let n=0,o=t.length-1;for(;o-n>1;){const r=n+o>>1;t[r]<=e?n=r:o=r}return[n,o]}function Nr(t){const e=$r(t.length>0?t:xn),n=new Float64Array(e.length),o=new Float64Array(e.length);return e.forEach((r,a)=>{n[a]=r.x,o[a]=r.y}),{xs:n,ys:o}}function lc(t){const{xs:e,ys:n}=Nr(t),o=e.length,r=new Float64Array(o);if(o>=3){const a=o-2,i=new Float64Array(a),s=new Float64Array(a),c=new Float64Array(a),l=new Float64Array(a);for(let u=0;u<a;u++){const f=u+1,m=e[f]-e[f-1],d=e[f+1]-e[f];i[u]=m,s[u]=2*(m+d),c[u]=d,l[u]=6*((n[f+1]-n[f])/d-(n[f]-n[f-1])/m)}for(let u=1;u<a;u++){const f=i[u]/s[u-1];s[u]=s[u]-f*c[u-1],l[u]=l[u]-f*l[u-1]}r[a]=l[a-1]/s[a-1];for(let u=a-2;u>=0;u--)r[u+1]=(l[u]-c[u]*r[u+2])/s[u]}return a=>{if(o===1||a<=e[0])return nt(n[0]);if(a>=e[o-1])return nt(n[o-1]);const[i,s]=Br(e,a),c=e[s]-e[i],l=(e[s]-a)/c,u=(a-e[i])/c;return nt(l*n[i]+u*n[s]+((l*l*l-l)*r[i]+(u*u*u-u)*r[s])*c*c/6)}}function uc(t){const{xs:e,ys:n}=Nr(t),o=e.length,r=new Float64Array(o);if(o>=2){const a=new Float64Array(o-1);for(let i=0;i<o-1;i++)a[i]=(n[i+1]-n[i])/(e[i+1]-e[i]);r[0]=a[0],r[o-1]=a[o-2];for(let i=1;i<o-1;i++){const s=a[i-1],c=a[i];r[i]=s*c<=0?0:(s+c)/2}for(let i=0;i<o-1;i++){const s=a[i];if(s===0){r[i]=0,r[i+1]=0;continue}const c=r[i]/s,l=r[i+1]/s;c<0&&(r[i]=0),l<0&&(r[i+1]=0);const u=c*c+l*l;if(u>9){const f=3/Math.sqrt(u);r[i]=f*c*s,r[i+1]=f*l*s}}}return a=>{if(o===1||a<=e[0])return nt(n[0]);if(a>=e[o-1])return nt(n[o-1]);const[i,s]=Br(e,a),c=e[s]-e[i],l=(a-e[i])/c,u=l*l,f=u*l;return nt((2*f-3*u+1)*n[i]+(f-2*u+l)*c*r[i]+(-2*f+3*u)*n[s]+(f-u)*c*r[s])}}function fc(t){const e=$r(t.length>0?t:xn),n=e.length;return o=>{if(n===1||o<=e[0].x)return nt(e[0].y);if(o>=e[n-1].x)return nt(e[n-1].y);let r=0;for(;r<n-2&&e[r+1].x<=o;)r++;const a=e[r],i=e[r+1],s=(o-a.x)/(i.x-a.x);return nt(a.y+(i.y-a.y)*s)}}function mc(t,e="natural"){return e==="linear"?fc(t):e==="spline"?uc(t):lc(t)}function mo(t,e="natural"){const n=mc(t,e),o=new Uint8Array(256);for(let r=0;r<256;r++)o[r]=Math.min(255,Math.max(0,Math.floor(n(r/255)*255+.5)));return o}const Wr=(t,e,n,o)=>({key:t,categoryId:"correction",labelKey:v(e),type:"enum",options:n.map(r=>({value:r,labelKey:v(`${o}.${r}`)})),hasDynamics:!1,dynamicsAllowed:[]}),qt=["rgb","r","g","b"],wn=16,dc=R({x:w().min(0).max(1),y:w().min(0).max(1)}).strict(),te=Ce(dc).min(2).max(wn).default(()=>xn.map(t=>({...t}))),hc=R({channel:Q(qt).default("rgb"),rgb:te,r:te,g:te,b:te}).strict();function gc(t){const e=mo(t.rgb),n=[t.r,t.g,t.b].map(r=>mo(r)),o=new Uint8Array(1024);for(let r=0;r<256;r++)o[r*4]=e[n[0][r]],o[r*4+1]=e[n[1][r]],o[r*4+2]=e[n[2][r]],o[r*4+3]=r;return o}const pc={id:st.curves,titleKey:v("correction.curves"),params:F(hc),meta:[Wr("channel","param.curves.channel",qt,"param.levels.channel"),...qt.map(t=>({key:t,categoryId:"correction",labelKey:v("param.curves.curve"),type:"curve",hasDynamics:!1,dynamicsAllowed:[],visibleWhen:e=>(e.settings?.channel??"rgb")===t}))],lut:gc},fn=["shadows","midtones","highlights"],ft=w().int().min(-100).max(100).default(0),yc=R({range:Q(fn).default("midtones"),shadowsCR:ft,shadowsMG:ft,shadowsYB:ft,midtonesCR:ft,midtonesMG:ft,midtonesYB:ft,highlightsCR:ft,highlightsMG:ft,highlightsYB:ft,preserveLuminosity:Dt().default(!0)}).strict();function _c(t){const e=n=>n<0?0:n>1?1:n;return[e(1.5-3*t),e(1-3*Math.abs(t-.5)),e(3*t-1.5)]}const Ur=.5;function vc(t,e,n,o){const r=(Math.max(t,e,n)+Math.min(t,e,n))/2,[a,i,s]=_c(r),c=Ur/100,l=(a*o.shadowsCR+i*o.midtonesCR+s*o.highlightsCR)*c,u=(a*o.shadowsMG+i*o.midtonesMG+s*o.highlightsMG)*c,f=(a*o.shadowsYB+i*o.midtonesYB+s*o.highlightsYB)*c,m=g=>g<0?0:g>1?1:g;let d=m(t+l),h=m(e+u),p=m(n+f);if(o.preserveLuminosity){const g=.299*t+.587*e+.114*n,_=.299*d+.587*h+.114*p,y=g-_;d=m(d+y),h=m(h+y),p=m(p+y)}return[d,h,p]}const xc=`uniform vec3 u_shadows;
uniform vec3 u_midtones;
uniform vec3 u_highlights;
uniform int u_preserve;
vec3 og_correction(vec3 c) {
  float l = (max(c.r, max(c.g, c.b)) + min(c.r, min(c.g, c.b))) * 0.5;
  float ws = clamp(1.5 - 3.0 * l, 0.0, 1.0);
  float wm = clamp(1.0 - 3.0 * abs(l - 0.5), 0.0, 1.0);
  float wh = clamp(3.0 * l - 1.5, 0.0, 1.0);
  vec3 d = (ws * u_shadows + wm * u_midtones + wh * u_highlights) * ${(Ur/100).toFixed(6)};
  vec3 n = clamp(c + d, 0.0, 1.0);
  if (u_preserve != 0) {
    vec3 w = vec3(0.299, 0.587, 0.114);
    n = clamp(n + (dot(c, w) - dot(n, w)), 0.0, 1.0);
  }
  return n;
}
`,je=(t,e,n)=>({key:t,categoryId:"correction",labelKey:v(e),type:"number",min:-100,max:100,step:1,display:"numeric",hasDynamics:!1,dynamicsAllowed:[],visibleWhen:o=>(o.settings?.range??"midtones")===n}),wc={id:st.colorBalance,titleKey:v("correction.colorBalance"),params:F(yc),meta:[Wr("range","param.colorBalance.range",fn,"param.colorBalance.range"),...fn.flatMap(t=>[je(`${t}CR`,"param.colorBalance.cyanRed",t),je(`${t}MG`,"param.colorBalance.magentaGreen",t),je(`${t}YB`,"param.colorBalance.yellowBlue",t)]),{key:"preserveLuminosity",categoryId:"correction",labelKey:v("param.colorBalance.preserveLuminosity"),type:"boolean",hasDynamics:!1,dynamicsAllowed:[]}],fn:(t,e)=>{for(let n=0;n+2<t.length;n+=3){const[o,r,a]=vc(t[n],t[n+1],t[n+2],e);t[n]=o,t[n+1]=r,t[n+2]=a}},glsl:xc,uniforms:t=>({u_shadows:[t.shadowsCR,t.shadowsMG,t.shadowsYB],u_midtones:[t.midtonesCR,t.midtonesMG,t.midtonesYB],u_highlights:[t.highlightsCR,t.highlightsMG,t.highlightsYB],u_preserve:t.preserveLuminosity?1:0})},bn=32,ee=w().int().min(0).max(255),bc=R({pos:w().min(0).max(1),r:ee,g:ee,b:ee,a:ee.default(255)}).strict(),Mc=Object.freeze([{pos:0,r:0,g:0,b:0,a:255},{pos:1,r:255,g:255,b:255,a:255}]),Ac=R({stops:Ce(bc).min(2).max(bn).default(()=>Mc.map(t=>({...t}))),reverse:Dt().default(!1)}).strict();function ke(t){const e=t.stops.map((r,a)=>({s:r,i:a})).sort((r,a)=>r.s.pos-a.s.pos||r.i-a.i).map(r=>r.s),n=new Uint8Array(1024),o=r=>r<=0?0:r>=255?255:Math.floor(r+.5);for(let r=0;r<256;r++){const a=t.reverse?1-r/255:r/255;let i=e[0],s=e[e.length-1],c=0;if(a<=i.pos)s=i;else if(a>=s.pos)i=s;else for(let l=0;l<e.length-1;l++){const u=e[l],f=e[l+1];if(a>=u.pos&&a<=f.pos){i=u,s=f,c=f.pos>u.pos?(a-u.pos)/(f.pos-u.pos):0;break}}n[r*4]=o(i.r+(s.r-i.r)*c),n[r*4+1]=o(i.g+(s.g-i.g)*c),n[r*4+2]=o(i.b+(s.b-i.b)*c),n[r*4+3]=o(i.a+(s.a-i.a)*c)}return n}function kc(t,e,n,o){const r=Or(e,n,o),a=t[r*4+3],i=(s,c)=>Math.floor((s*(255-a)+c*a+127)/255);return[i(e,t[r*4]),i(n,t[r*4+1]),i(o,t[r*4+2])]}const Ec=`uniform sampler2D u_gmap;
vec3 og_correction(vec3 c) {
  ivec3 v = ivec3(floor(c * 255.0 + 0.5));
  int l = (299 * v.r + 587 * v.g + 114 * v.b + 500) / 1000;
  ivec4 g = ivec4(floor(texelFetch(u_gmap, ivec2(l, 0), 0) * 255.0 + 0.5));
  ivec3 o = (v * (255 - g.a) + g.rgb * g.a + 127) / 255;
  return vec3(o) / 255.0;
}
`,Tc={id:st.gradientMap,titleKey:v("correction.gradientMap"),params:F(Ac),meta:[{key:"reverse",categoryId:"correction",labelKey:v("param.gradientMap.reverse"),type:"boolean",hasDynamics:!1,dynamicsAllowed:[]}],fn:(t,e)=>{const n=ke(e);for(let o=0;o+2<t.length;o+=3){const[r,a,i]=kc(n,Math.round(t[o]*255),Math.round(t[o+1]*255),Math.round(t[o+2]*255));t[o]=r/255,t[o+1]=a/255,t[o+2]=i/255}},glsl:Ec,uniforms:t=>({u_gmap:Int32Array.from(ke(t))})},ho=(t,e,n)=>R({r:w().int().min(0).max(255),g:w().int().min(0).max(255),b:w().int().min(0).max(255)}).strict().default({r:t,g:e,b:n}),Pc=R({from:ho(0,0,0),to:ho(255,0,0),tolerance:w().int().min(0).max(255).default(32),softness:w().int().min(0).max(255).default(32)}).strict();function Rc(t,e,n){if(t<=e)return 256;if(n<=0||t>=e+n)return 0;const o=256-Math.floor((512*(t-e)+n)/(2*n));return o<0?0:o}function Lc(t,e,n,o){const r=Math.max(Math.abs(t-o.from.r),Math.abs(e-o.from.g),Math.abs(n-o.from.b)),a=Rc(r,o.tolerance,o.softness),i=(s,c)=>s*(256-a)+c*a+128>>8;return[i(t,o.to.r),i(e,o.to.g),i(n,o.to.b)]}const go=(t,e,n)=>({key:t,categoryId:"correction",labelKey:v(`param.colorReplace.${t}`),type:"number",min:e,max:n,step:1,display:"numeric",hasDynamics:!1,dynamicsAllowed:[]}),Ic=`uniform ivec3 u_from;
uniform ivec3 u_to;
uniform int u_tol;
uniform int u_soft;
vec3 og_correction(vec3 s) {
  ivec3 c = ivec3(floor(s * 255.0 + 0.5));
  ivec3 dd = abs(c - u_from);
  int d = max(dd.r, max(dd.g, dd.b));
  int W = 0;
  if (d <= u_tol) W = 256;
  else if (u_soft > 0 && d < u_tol + u_soft) W = max(0, 256 - (512 * (d - u_tol) + u_soft) / (2 * u_soft));
  ivec3 o = (c * (256 - W) + u_to * W + 128) >> 8;
  return vec3(o) / 255.0;
}
`,Cc={id:st.colorReplace,titleKey:v("correction.colorReplace"),params:F(Pc),meta:[go("tolerance",0,255),go("softness",0,255)],fn(t,e){for(let n=0;n+2<t.length;n+=3){const[o,r,a]=Lc(Math.round(t[n]*255),Math.round(t[n+1]*255),Math.round(t[n+2]*255),e);t[n]=o/255,t[n+1]=r/255,t[n+2]=a/255}},glsl:Ic,uniforms:t=>({u_from:[t.from.r,t.from.g,t.from.b],u_to:[t.to.r,t.to.g,t.to.b],u_tol:t.tolerance,u_soft:t.softness})},Sc=65536,Dc=16384,ce=Array.from({length:257},(t,e)=>Math.round(Math.sin(e/256*Math.PI/2)*Dc)),le=Array.from({length:257},(t,e)=>Math.round(Math.atan(e/256)*Sc/(2*Math.PI))),Oc=(t,e)=>Math.floor(t/e),po=(t,e)=>Math.floor((2*t+e)/(2*e)),Mn=(t,e)=>t-Oc(t,e)*e;function Yt(t){const e=t&65535,n=e>>14;let o=e&16383;n&1&&(o=16384-o);const r=Math.min(o>>6,255),a=o-r*64,i=ce[r]+((ce[r+1]-ce[r])*a+32>>6);return n>=2?-i:i}const zr=t=>Yt(t+16384);function Fc(t,e){const n=Math.abs(e),o=Math.abs(t);if(n===0&&o===0)return 0;let r=Math.max(n,o),a=Math.min(n,o);for(;r>=65536;)r>>=1,a>>=1;const i=Math.floor(a*16384/r),s=Math.min(i>>6,255),c=i-s*64;let l=le[s]+((le[s+1]-le[s])*c+32>>6);return o>n&&(l=16384-l),e<0&&(l=32768-l),t<0&&(l=65536-l),l&65535}function $c(t){let e=Math.floor(Math.sqrt(t));for(;e*e>t;)e--;for(;(e+1)*(e+1)<=t;)e++;return e}function K(t,e,n){const o=t>>12,r=t&4095;return o*e+(r*e+(1<<n-1)>>12)>>n-12}function Ot(t,e,n){let o=Math.floor(t/e),r=t-o*e;for(let a=0;a<n;a++)r*=2,o*=2,r>=e&&(r-=e,o+=1);return o}const Ye=(t,e,n)=>t<0?-Ot(-t,e,n):Ot(t,e,n);function Ue(t,e){const n=Math.abs(t),o=Math.abs(e);let r=Math.max(n,o);if(r===0)return{ux:0,uy:0,len:0};let a=0;for(;r<8192;)r*=2,a++;for(;r>=16384;)r>>=1,a--;const i=a>=0?n<<a:n>>-a,s=a>=0?o<<a:o>>-a,c=$c(i*i+s*s),l=po(i*16384,c),u=po(s*16384,c),f=a>=0?c>>a:c<<-a;return{ux:t<0?-l:l,uy:e<0?-u:u,len:f}}function Gr(t){const e=t&65535;return e<16384?e:e<49152?32768-e:e-65536}const yo=(t,e)=>`const int ${t}[${e.length}] = int[${e.length}](${e.join(", ")});`,Xr=`${yo("OG_SIN_T",ce)}
${yo("OG_ATAN_T",le)}
int og_floorDiv(int a, int b) { return a >= 0 ? a / b : -((b - 1 - a) / b); }
int og_roundDiv(int a, int b) { return og_floorDiv(2 * a + b, 2 * b); }
int og_floorMod(int a, int b) { return a - og_floorDiv(a, b) * b; }
int og_sinQ(int phase) {
  int p = phase & 65535;
  int q = p >> 14;
  int w = p & 16383;
  if ((q & 1) == 1) w = 16384 - w;
  int i = min(w >> 6, 255);
  int fr = w - i * 64;
  int v = OG_SIN_T[i] + (((OG_SIN_T[i + 1] - OG_SIN_T[i]) * fr + 32) >> 6);
  return q >= 2 ? -v : v;
}
int og_cosQ(int phase) { return og_sinQ(phase + 16384); }
int og_atanQ(int y, int x) {
  int ax = abs(x);
  int ay = abs(y);
  if (ax == 0 && ay == 0) return 0;
  int mx = max(ax, ay);
  int mn = min(ax, ay);
  for (int k = 0; k < 10; k++) {
    if (mx >= 65536) {
      mx >>= 1;
      mn >>= 1;
    }
  }
  int t = (mn * 16384) / mx;
  int i = min(t >> 6, 255);
  int fr = t - i * 64;
  int a = OG_ATAN_T[i] + (((OG_ATAN_T[i + 1] - OG_ATAN_T[i]) * fr + 32) >> 6);
  if (ay > ax) a = 16384 - a;
  if (x < 0) a = 32768 - a;
  if (y < 0) a = 65536 - a;
  return a & 65535;
}
int og_isqrt(int D) {
  int r = int(sqrt(float(D)));
  for (int k = 0; k < 3; k++) if (r * r > D) r--;
  for (int k = 0; k < 3; k++) if ((r + 1) * (r + 1) <= D) r++;
  return r;
}
int og_mulRound(int a, int b, int s) {
  int ah = a >> 12;
  int al = a & 4095;
  return (ah * b + ((al * b + (1 << (s - 1))) >> 12)) >> (s - 12);
}
int og_fracDiv(int n, int d, int bits) {
  int q = n / d;
  int r = n - q * d;
  for (int i = 0; i < 16; i++) {
    if (i >= bits) break;
    r *= 2;
    q *= 2;
    if (r >= d) {
      r -= d;
      q += 1;
    }
  }
  return q;
}
int og_fracDivS(int n, int d, int bits) { return n < 0 ? -og_fracDiv(-n, d, bits) : og_fracDiv(n, d, bits); }
ivec3 og_normVec(ivec2 v) {
  int ax = abs(v.x);
  int ay = abs(v.y);
  int m = max(ax, ay);
  if (m == 0) return ivec3(0);
  int e = 0;
  for (int k = 0; k < 14; k++) {
    if (m < 8192) {
      m *= 2;
      e++;
    }
  }
  for (int k = 0; k < 12; k++) {
    if (m >= 16384) {
      m >>= 1;
      e--;
    }
  }
  int sx = e >= 0 ? ax << e : ax >> (-e);
  int sy = e >= 0 ? ay << e : ay >> (-e);
  int d = og_isqrt(sx * sx + sy * sy);
  int ux = og_roundDiv(sx * 16384, d);
  int uy = og_roundDiv(sy * 16384, d);
  int len = e >= 0 ? d >> e : d << (-e);
  return ivec3(v.x < 0 ? -ux : ux, v.y < 0 ? -uy : uy, len);
}
int og_triQ(int phase) {
  int p = phase & 65535;
  return p < 16384 ? p : (p < 49152 ? 32768 - p : p - 65536);
}
`;function An(t){const e=t.canvas;if(e)return e;const n=1<<Math.max(0,t.level);return{x:t.rect.x*n,y:t.rect.y*n,w:t.rect.w*n,h:t.rect.h*n}}function Bc(t){const e=t.canvas;if(!e)return t.rect;const n=1<<Math.max(0,t.level),o=Math.floor(e.x/n),r=Math.floor(e.y/n);return{x:o,y:r,w:Math.ceil((e.x+e.w)/n)-o,h:Math.ceil((e.y+e.h)/n)-r}}function qr(t,e,n,o){const r=Bc(t),a=Math.max(0,r.x-e.x),i=Math.max(0,r.y-e.y),s=Math.min(n,r.x+r.w-e.x),c=Math.min(o,r.y+r.h-e.y);return[a,i,s,c]}const Kr=t=>t.edgeMode==="clamp";function Vr(t,e){const n=t.apronPx,o=t.origin.x-n,r=t.origin.y-n,[a,i,s,c]=qr(e,{x:o,y:r},t.w,t.h);return{data:At(t),w:t.w,h:t.h,cx0:a,cy0:i,cx1:s,cy1:c,clamp:Kr(e),rx:o,ry:r}}function Nc(t,e,n){if(e>=0&&n>=0&&e<t.w&&n<t.h)return(n*t.w+e)*4;if(!t.clamp||t.cx1<=t.cx0||t.cy1<=t.cy0)return-1;const o=e<t.cx0?t.cx0:e>=t.cx1?t.cx1-1:e;return((n<t.cy0?t.cy0:n>=t.cy1?t.cy1-1:n)*t.w+o)*4}function ue(t,e,n,o){const r=e>>8,a=n>>8,i=e&255,s=n&255;let c=0,l=0,u=0,f=0;for(let m=0;m<4;m++){const d=((m&1)===0?256-i:i)*(m>>1===0?256-s:s);if(d===0)continue;const h=Nc(t,r+(m&1),a+(m>>1));h<0||(c+=t.data[h]*d,l+=t.data[h+1]*d,u+=t.data[h+2]*d,f+=t.data[h+3]*d)}o[0]=c+32768>>16,o[1]=l+32768>>16,o[2]=u+32768>>16,o[3]=f+32768>>16}const Ee=(t,e,n)=>16*(1<<n)*(t+e)+8*(1<<n),_t=(t,e,n)=>(t*16+(1<<n>>1)>>n)-e*256-128,jr=`uniform ivec4 u_crect;
uniform int u_edge;
uniform ivec2 u_rorigin;
uniform int u_L;
vec4 og_fetchE(ivec2 i) {
  if (i.x >= 0 && i.y >= 0 && i.x < u_origSize.x && i.y < u_origSize.y) return texelFetch(u_orig, i, 0);
  if (u_edge == 1 && u_crect.z > u_crect.x && u_crect.w > u_crect.y)
    return texelFetch(u_orig, clamp(i, u_crect.xy, u_crect.zw - 1), 0);
  return vec4(0.0);
}
ivec4 og_sampleQ(ivec2 q) {
  ivec2 i = q >> 8;
  ivec2 t = q & 255;
  ivec2 u = 256 - t;
  ivec4 a = ivec4(og_i8(og_fetchE(i)));
  ivec4 b = ivec4(og_i8(og_fetchE(i + ivec2(1, 0))));
  ivec4 c = ivec4(og_i8(og_fetchE(i + ivec2(0, 1))));
  ivec4 d = ivec4(og_i8(og_fetchE(i + ivec2(1, 1))));
  ivec4 s = a * (u.x * u.y) + b * (t.x * u.y) + c * (u.x * t.y) + d * (t.x * t.y);
  return (s + 32768) >> 16;
}
ivec2 og_P16(ivec2 p) {
  int f = 1 << u_L;
  return 16 * f * (u_rorigin + p) + 8 * f;
}
ivec2 og_toQ(ivec2 s) {
  int f = 1 << u_L;
  return ((s * 16 + (f >> 1)) >> u_L) - u_rorigin * 256 - 128;
}
`;function Te(t,e){const n={x:e.origin.x-e.apron,y:e.origin.y-e.apron};return{u_crect:qr(t,n,e.w,e.h),u_edge:Kr(t)?1:0,u_rorigin:[n.x,n.y],u_L:Math.max(0,t.level)}}const mn=12;function Wc(t,e,n,o,r){const a=Vr(n,r),i=n.apronPx,s=Math.max(0,r.level),c=new Int32Array(4);for(let l=0;l<o.h;l++){const u=Ee(a.ry,l+i,s);for(let f=0;f<o.w;f++){const m=Ee(a.rx,f+i,s),d=t.map(e,m,u);ue(a,_t(d[0],a.rx,s),_t(d[1],a.ry,s),c);const h=l*o.stride+f*4;o.data[h]=c[0],o.data[h+1]=c[1],o.data[h+2]=c[2],o.data[h+3]=c[3]}}}const Uc=`void main() {
  ivec2 p = og_pixel();
  ivec2 S = og_map(og_P16(p));
  fragColor = vec4(og_sampleQ(og_toQ(S))) / 255.0;
}
`,Yr=t=>{if(t.length>mn)throw new Error("filters: remap constants exceed u_k");return[...t,...new Array(mn-t.length).fill(0)]};function zc(t,e,n,o){return[{frag:t,uniforms:{...Te(n,o),u_k:Yr(e)}}]}function Gc(t,e){return{...Te(e,{w:e.rect.w,h:e.rect.h,apron:0,origin:{x:e.rect.x,y:e.rect.y}}),u_k:Yr(t)}}const at=(t,e,n,o,r,a={})=>({key:t,categoryId:"correction",labelKey:v(e),type:"number",min:n,max:o,step:r,display:"numeric",hasDynamics:!1,dynamicsAllowed:[],...a}),Pe=(t,e,n)=>({key:t,categoryId:"correction",labelKey:v(e),type:"enum",options:n.map(o=>({value:o,labelKey:v(`${e}.${o}`)})),hasDynamics:!1,dynamicsAllowed:[]}),ze={centerX:w().min(-1e5).max(1e5).nullable().default(null),centerY:w().min(-1e5).max(1e5).nullable().default(null)},Ge=(t,e)=>({x:t.centerX??e.w/2,y:t.centerY??e.h/2});function kn(t){const e=t.point??(()=>{const n=An(t);return{x:n.x+n.w/2,y:n.y+n.h/2}})();return[Math.round(e.x*16),Math.round(e.y*16)]}const Hr=t=>Math.round(t/360*65536)&65535,Ft=t=>Math.round(t*16),Ht=(t,e)=>Math.ceil(t/(1<<Math.max(0,e)))+2,Xc=t=>`${Xr}${jr}uniform int u_k[${mn}];
${t.glsl}
${Uc}`;function $t(t){const e=Xc(t.def);return{id:U(t.id),titleKey:v(t.titleKey),category:"distort",params:F(t.params),meta:t.meta,apronPx:n=>t.apronAt(n,0),apronAt:t.apronAt,gpu:{passes:[{frag:e}],uniforms:(n,o)=>Gc(t.consts(n,o),o)},gpuPlan:(n,o,r)=>zc(e,t.consts(n,o),o,r),cpu:(n,o,r,a)=>Wc(t.def,t.consts(o,a),n,r,a),previewStrategy:"proxy",recordable:!0,...t.extra}}const En=["horizontal","vertical","both"],Tn=["sine","triangle","square"],Qr=500,Zr=2e3,qc=R({amplitude:w().min(0).max(Qr).default(10),wavelength:w().min(2).max(Zr).default(80),phase:w().min(0).max(360).default(0),direction:Q(En).default("horizontal"),shape:Q(Tn).default("sine")}).strict();function Kc(t,e){return t===0?Yt(e):t===1?Gr(e):(e&65535)<32768?16384:-16384}function _o(t,e){const n=t[3],o=Ot(Mn(e,n),n,16)+t[4]&65535;return K(t[2],Kc(t[1],o),14)}const Vc={map:(t,e,n)=>[e+(t[0]!==1?_o(t,n):0),n+(t[0]!==0?_o(t,e):0)],glsl:`int og_waveShape(int shape, int ph) {
  return shape == 0 ? og_sinQ(ph) : (shape == 1 ? og_triQ(ph) : ((ph & 65535) < 32768 ? 16384 : -16384));
}
int og_waveOffset(int coord) {
  int lam = u_k[3];
  int ph = (og_fracDiv(og_floorMod(coord, lam), lam, 16) + u_k[4]) & 65535;
  return og_mulRound(u_k[2], og_waveShape(u_k[1], ph), 14);
}
ivec2 og_map(ivec2 P) {
  return P + ivec2(u_k[0] != 1 ? og_waveOffset(P.y) : 0, u_k[0] != 0 ? og_waveOffset(P.x) : 0);
}`},jc=t=>[En.indexOf(t.direction),Tn.indexOf(t.shape),Ft(t.amplitude),Math.max(32,Ft(t.wavelength)),Hr(t.phase)],Yc=$t({id:"filters.wave",titleKey:"filter.wave",params:qc,meta:[at("amplitude","param.wave.amplitude",0,Qr,1,{unit:"px"}),at("wavelength","param.wave.wavelength",2,Zr,1,{unit:"px"}),at("phase","param.wave.phase",0,360,1,{unit:"deg"}),Pe("direction","param.wave.direction",En),Pe("shape","param.wave.shape",Tn)],def:Vc,consts:t=>jc(t),apronAt:(t,e)=>Ht(t.amplitude,e)}),Pn=200,Rn=2e3,Hc=R({amplitude:w().min(0).max(Pn).default(6),wavelength:w().min(2).max(Rn).default(40),phase:w().min(0).max(360).default(0),...ze}).strict(),Jr=["around","outward"],Qc=R({amplitude:w().min(0).max(Pn).default(8),wavelength:w().min(2).max(Rn).default(40),phase:w().min(0).max(360).default(0),style:Q(Jr).default("around"),...ze}).strict();function Zc(t,e,n){const o=Ue(e-t[0],n-t[1]);if(o.len===0)return[e,n];const r=t[3],a=Ot(Mn(o.len,r),r,16)+t[4]&65535,i=K(t[2],t[5]===0?Yt(a):Gr(a),14);return t[6]===1?[e+K(i,-o.uy,14),n+K(i,o.ux,14)]:[e+K(i,o.ux,14),n+K(i,o.uy,14)]}const ta={map:Zc,glsl:`ivec2 og_map(ivec2 P) {
  ivec3 n = og_normVec(P - ivec2(u_k[0], u_k[1]));
  if (n.z == 0) return P;
  int lam = u_k[3];
  int ph = (og_fracDiv(og_floorMod(n.z, lam), lam, 16) + u_k[4]) & 65535;
  int d = og_mulRound(u_k[2], u_k[5] == 0 ? og_sinQ(ph) : og_triQ(ph), 14);
  if (u_k[6] == 1) return P + ivec2(og_mulRound(d, -n.y, 14), og_mulRound(d, n.x, 14));
  return P + ivec2(og_mulRound(d, n.x, 14), og_mulRound(d, n.y, 14));
}`},ea=(t,e,n,o)=>{const[r,a]=kn(e);return[r,a,Ft(t.amplitude),Math.max(32,Ft(t.wavelength)),Hr(t.phase),n,o]},na=t=>[at("amplitude",`param.${t}.amplitude`,0,Pn,1,{unit:"px"}),at("wavelength",`param.${t}.wavelength`,2,Rn,1,{unit:"px"}),at("phase",`param.${t}.phase`,0,360,1,{unit:"deg"})],Jc=$t({id:"filters.ripple",titleKey:"filter.ripple",params:Hc,meta:na("ripple"),def:ta,consts:(t,e)=>ea(t,e,0,0),apronAt:(t,e)=>Ht(t.amplitude,e),extra:{pickPoint:!0,resolvePoint:Ge}}),tl=$t({id:"filters.zigzag",titleKey:"filter.zigzag",params:Qc,meta:[...na("zigzag"),Pe("style","param.zigzag.style",Jr)],def:ta,consts:(t,e)=>ea(t,e,1,t.style==="around"?1:0),apronAt:(t,e)=>Ht(t.amplitude,e),extra:{pickPoint:!0,resolvePoint:Ge}}),Xe=2e3,el=R({angle:w().min(-1080).max(1080).default(180),radius:w().min(1).max(Xe).default(300),...ze}).strict(),nl=R({strength:w().min(-100).max(100).default(50),radius:w().min(1).max(Xe).default(300),...ze}).strict();function oa(t,e){if(t>=e)return null;const n=16384-Ot(t,e,14);return n*n>>14}const ra=`int og_diskWeight(int len, int R) {
  if (len >= R) return -1;
  int om = 16384 - og_fracDiv(len, R, 14);
  return (om * om) >> 14;
}
`;function ol(t,e,n){const o=e-t[0],r=n-t[1],a=Ue(o,r),i=oa(a.len,t[2]);if(i===null)return[e,n];const s=K(t[3],i,14),c=zr(s),l=Yt(s);return[t[0]+(o*c+r*l+8192>>14),t[1]+(-o*l+r*c+8192>>14)]}const rl={map:ol,glsl:`${ra}ivec2 og_map(ivec2 P) {
  ivec2 C = ivec2(u_k[0], u_k[1]);
  ivec2 v = P - C;
  int w = og_diskWeight(og_normVec(v).z, u_k[2]);
  if (w < 0) return P;
  int th = og_mulRound(u_k[3], w, 14);
  int c = og_cosQ(th);
  int s = og_sinQ(th);
  return C + ivec2((v.x * c + v.y * s + 8192) >> 14, (-v.x * s + v.y * c + 8192) >> 14);
}`};function al(t,e,n){const o=e-t[0],r=n-t[1],a=oa(Ue(o,r).len,t[2]);if(a===null)return[e,n];const i=16384-K(t[3],a,14);return[t[0]+K(o,i,14),t[1]+K(r,i,14)]}const il={map:al,glsl:`${ra}ivec2 og_map(ivec2 P) {
  ivec2 C = ivec2(u_k[0], u_k[1]);
  ivec2 v = P - C;
  int w = og_diskWeight(og_normVec(v).z, u_k[2]);
  if (w < 0) return P;
  int g = 16384 - og_mulRound(u_k[3], w, 14);
  return C + ivec2(og_mulRound(v.x, g, 14), og_mulRound(v.y, g, 14));
}`},aa=(t,e,n)=>{const o=e??{x:n.w/2,y:n.h/2},r=Math.floor(o.x-t.radius)-1,a=Math.floor(o.y-t.radius)-1,i=Math.ceil(o.x+t.radius)+1,s=Math.ceil(o.y+t.radius)+1;return{x:r,y:a,w:i-r,h:s-a}},sl=t=>Math.min(2*t.radius,Math.abs(t.angle)*Math.PI/180*(4*t.radius/27)),cl=t=>Math.abs(t.strength)/100*(4*t.radius/27),ll=$t({id:"filters.spiral",titleKey:"filter.spiral",params:el,meta:[at("angle","param.spiral.angle",-1080,1080,1,{unit:"deg"}),at("radius","param.spiral.radius",1,Xe,1,{unit:"px"})],def:rl,consts:(t,e)=>{const[n,o]=kn(e);return[n,o,Ft(t.radius),Math.round(t.angle/360*65536)]},apronAt:(t,e)=>Ht(sl(t),e),extra:{pickPoint:!0,resolvePoint:Ge,singleRegion:(t,e,n)=>aa(t,n,e)}}),ul=$t({id:"filters.fisheye",titleKey:"filter.fisheye",params:nl,meta:[at("strength","param.fisheye.strength",-100,100,1,{unit:"percent"}),at("radius","param.fisheye.radius",1,Xe,1,{unit:"px"})],def:il,consts:(t,e)=>{const[n,o]=kn(e);return[n,o,Ft(t.radius),Math.round(t.strength/100*16384)]},apronAt:(t,e)=>Ht(cl(t),e),extra:{pickPoint:!0,resolvePoint:Ge,singleRegion:(t,e,n)=>aa(t,n,e)}}),ia=["rectToPolar","polarToRect"],fl=R({mode:Q(ia).default("rectToPolar")}).strict(),ml=128;function dl(t,e,n){const o=t[0],r=t[1],a=t[2],i=t[3],s=a>>1,c=i>>1,l=o+s,u=r+c;if(t[4]===0){const p=Ye(e-l,s,14),g=Ye(n-u,c,14),_=Fc(p,-g),y=Ue(p,g).len;return[o+K(a,_,16),r+K(i,y,14)]}const f=Ot(Mn(e-o,a),a,16),m=Ye(n-r,i,14),d=K(s,m,14),h=K(c,m,14);return[l+K(d,Yt(f),14),u-K(h,zr(f),14)]}const hl={map:dl,glsl:`ivec2 og_map(ivec2 P) {
  int ox = u_k[0];
  int oy = u_k[1];
  int W = u_k[2];
  int H = u_k[3];
  int Wh = W >> 1;
  int Hh = H >> 1;
  int cx = ox + Wh;
  int cy = oy + Hh;
  if (u_k[4] == 0) {
    int u = og_fracDivS(P.x - cx, Wh, 14);
    int v = og_fracDivS(P.y - cy, Hh, 14);
    int ph = og_atanQ(u, -v);
    int rho = og_normVec(ivec2(u, v)).z;
    return ivec2(ox + og_mulRound(W, ph, 16), oy + og_mulRound(H, rho, 14));
  }
  int ph = og_fracDiv(og_floorMod(P.x - ox, W), W, 16);
  int rho = og_fracDivS(P.y - oy, H, 14);
  int rx = og_mulRound(Wh, rho, 14);
  int ry = og_mulRound(Hh, rho, 14);
  return ivec2(cx + og_mulRound(rx, og_sinQ(ph), 14), cy - og_mulRound(ry, og_cosQ(ph), 14));
}`},gl=(t,e)=>{const n=An(e);return[16*n.x,16*n.y,Math.max(32,16*n.w),Math.max(32,16*n.h),t.mode==="rectToPolar"?0:1]},pl=$t({id:"filters.polarCoordinates",titleKey:"filter.polarCoordinates",params:fl,meta:[Pe("mode","param.polar.mode",ia)],def:hl,consts:gl,apronAt:(t,e)=>Math.ceil(ml/(1<<Math.max(0,e))),extra:{preservesTransparency:!1,singleRegion:(t,e)=>({x:0,y:0,w:e.w,h:e.h})}}),sa=["radial","linear"],ca=100,yl=R({amount:w().min(0).max(ca).default(4),mode:Q(sa).default("radial"),angle:w().min(-180).max(180).default(0),centerX:w().min(-1e5).max(1e5).nullable().default(null),centerY:w().min(-1e5).max(1e5).nullable().default(null)}).strict();function dn(t,e){const n=An(e),o=e.point??{x:n.x+n.w/2,y:n.y+n.h/2};if(t.mode==="linear"){const i=t.angle*Math.PI/180;return[1,0,0,0,Math.round(t.amount*16*Math.cos(i)),Math.round(-t.amount*16*Math.sin(i))]}let r=0;for(const[i,s]of[[n.x,n.y],[n.x+n.w,n.y],[n.x,n.y+n.h],[n.x+n.w,n.y+n.h]])r=Math.max(r,Math.hypot(i-o.x,s-o.y));const a=r>0?Math.min(1,t.amount/r):0;return[0,Math.round(o.x*16),Math.round(o.y*16),Math.round(a*65536),0,0]}function _l(t,e,n){return t[0]===1?[t[4],t[5]]:[K(e-t[1],t[3],16),K(n-t[2],t[3],16)]}function vl(t,e,n,o){const r=dn(e,o),a=Vr(t,o),i=t.apronPx,s=Math.max(0,o.level),c=new Int32Array(4),l=new Int32Array(4),u=new Int32Array(4);for(let f=0;f<n.h;f++){const m=Ee(a.ry,f+i,s);for(let d=0;d<n.w;d++){const h=Ee(a.rx,d+i,s),[p,g]=_l(r,h,m);ue(a,_t(h+p,a.rx,s),_t(m+g,a.ry,s),c),ue(a,_t(h,a.rx,s),_t(m,a.ry,s),l),ue(a,_t(h-p,a.rx,s),_t(m-g,a.ry,s),u);const _=f*n.stride+d*4;n.data[_]=c[0],n.data[_+1]=l[1],n.data[_+2]=u[2],n.data[_+3]=Math.max(c[3],l[3],u[3])}}}const vo=`${Xr}${jr}uniform int u_k[6];
void main() {
  ivec2 P = og_P16(og_pixel());
  ivec2 d = u_k[0] == 1 ? ivec2(u_k[4], u_k[5])
    : ivec2(og_mulRound(P.x - u_k[1], u_k[3], 16), og_mulRound(P.y - u_k[2], u_k[3], 16));
  ivec4 r = og_sampleQ(og_toQ(P + d));
  ivec4 g = og_sampleQ(og_toQ(P));
  ivec4 b = og_sampleQ(og_toQ(P - d));
  fragColor = vec4(float(r.r), float(g.g), float(b.b), float(max(r.a, max(g.a, b.a)))) / 255.0;
}
`,xo=(t,e,n,o,r,a={})=>({key:t,categoryId:"correction",labelKey:v(e),type:"number",min:n,max:o,step:r,display:"numeric",hasDynamics:!1,dynamicsAllowed:[],...a}),wo=(t,e)=>Math.ceil(t.amount/(1<<Math.max(0,e)))+2,xl={id:U("filters.chromaticAberration"),titleKey:v("filter.chromaticAberration"),category:"effect",params:F(yl),meta:[xo("amount","param.chromatic.amount",0,ca,.5,{unit:"px"}),{key:"mode",categoryId:"correction",labelKey:v("param.chromatic.mode"),type:"enum",options:sa.map(t=>({value:t,labelKey:v(`param.chromatic.mode.${t}`)})),hasDynamics:!1,dynamicsAllowed:[]},xo("angle","param.chromatic.angle",-180,180,1,{unit:"deg",visibleWhen:t=>t.settings?.mode==="linear"})],pickPoint:!0,resolvePoint:(t,e)=>({x:t.centerX??e.w/2,y:t.centerY??e.h/2}),preservesTransparency:!1,apronPx:t=>wo(t,0),apronAt:wo,gpu:{passes:[{frag:vo}],uniforms:(t,e)=>({...Te(e,{w:e.rect.w,h:e.rect.h,apron:0,origin:{x:e.rect.x,y:e.rect.y}}),u_k:dn(t,e)})},gpuPlan:(t,e,n)=>[{frag:vo,uniforms:{...Te(e,n),u_k:dn(t,e)}}],cpu:vl,previewStrategy:"proxy",recordable:!0},la=["gaussian","uniform"],wl=R({amount:w().min(0).max(100).default(20),type:Q(la).default("gaussian"),monochrome:Dt().default(!0),seed:w().int().min(0).max(65535).default(0)}).strict(),hn=(t,e)=>Math.floor(t/e);function bl(t,e,n){if(!n)return hn(((t&65535)-32768)*e,128);const o=(t&255)+(t>>>8&255)+(t>>>16&255)+(t>>>24)-510;return hn(o*e*128,148)}function Ml(t,e,n){const o=t+hn(n*e+32640,65280);return o<0?0:o>e?e:o}const ua=t=>Math.round(t.amount*2.55);function Al(t,e,n,o){const r=t.apronPx,a=1<<Math.max(0,o.level),i=ua(e),s=e.type==="gaussian";for(let c=0;c<n.h;c++){const l=(t.origin.y+c)*a;for(let u=0;u<n.w;u++){const f=(t.origin.x+u)*a,m=(c+r)*t.stride+(u+r)*4,d=c*n.stride+u*4,h=t.data[m+3];n.data[d+3]=h;for(let p=0;p<3;p++){const g=vr(f,l,e.monochrome?e.seed*4:e.seed*4+p);n.data[d+p]=h===0?0:Ml(t.data[m+p],h,bl(g,i,s))}}}}const bo=`uniform ivec2 u_origin;
uniform int u_f;
uniform int u_amt;
uniform int u_gauss;
uniform int u_mono;
uniform int u_seed;
uint og_hash(int ix, int iy, int seed) {
  uint h = (uint(ix + ${1<<22}) * 0x8da6b343u) ^ (uint(iy + ${1<<22}) * 0xd8163841u) ^ (uint(seed) * 0xcb1ab31fu);
  h ^= h >> 13u;
  h *= 0x85ebca6bu;
  h ^= h >> 16u;
  return h;
}
int og_floorDiv(int a, int b) { return a >= 0 ? a / b : -((b - 1 - a) / b); }
int og_noise(uint h) {
  if (u_gauss == 0) return og_floorDiv((int(h & 65535u) - 32768) * u_amt, 128);
  int s = int(h & 255u) + int((h >> 8u) & 255u) + int((h >> 16u) & 255u) + int(h >> 24u) - 510;
  return og_floorDiv(s * u_amt * 128, 148);
}
void main() {
  ivec2 p = og_pixel();
  ivec4 c = ivec4(og_i8(og_orig(p)));
  if (c.a == 0) { fragColor = vec4(0.0); return; }
  ivec2 q = (u_origin + p - ivec2(u_apron)) * u_f;
  ivec3 o;
  for (int k = 0; k < 3; k++) {
    int n = og_noise(og_hash(q.x, q.y, u_mono == 1 ? u_seed * 4 : u_seed * 4 + k));
    o[k] = clamp(c[k] + og_floorDiv(n * c.a + 32640, 65280), 0, c.a);
  }
  fragColor = vec4(vec3(o), float(c.a)) / 255.0;
}
`,Mo=(t,e,n)=>({u_origin:[n.x,n.y],u_f:1<<Math.max(0,e.level),u_amt:ua(t),u_gauss:t.type==="gaussian"?1:0,u_mono:t.monochrome?1:0,u_seed:t.seed}),ne=(t,e)=>({key:t,categoryId:"correction",labelKey:v(`param.addNoise.${t}`),type:"number",hasDynamics:!1,dynamicsAllowed:[],...e}),kl={id:U("filters.addNoise"),titleKey:v("filter.addNoise"),category:"effect",params:F(wl),meta:[ne("amount",{min:0,max:100,step:1,unit:"percent",display:"numeric"}),ne("type",{type:"enum",options:la.map(t=>({value:t,labelKey:v(`param.addNoise.type.${t}`)}))}),ne("monochrome",{type:"boolean"}),ne("seed",{min:0,max:65535,step:1,display:"numeric"})],preservesTransparency:!0,apronPx:()=>0,apronAt:()=>0,gpu:{passes:[{frag:bo}],uniforms:(t,e)=>Mo(t,e,{x:e.rect.x,y:e.rect.y})},gpuPlan:(t,e,n)=>[{frag:bo,uniforms:Mo(t,e,n.origin)}],cpu:Al,previewStrategy:"proxy",recordable:!0},xt=(t,e,n,o,r,a={})=>({key:t,categoryId:"correction",labelKey:v(e),type:"number",min:n,max:o,step:r,display:"numeric",hasDynamics:!1,dynamicsAllowed:[],...a}),fa=(t,e)=>Math.round(t/(1<<Math.max(0,e))),ma=20,da=5,El=R({blur:w().int().min(0).max(ma).default(2),colors:w().int().min(2).max(32).default(8),threshold:w().int().min(1).max(255).default(24),lineWidth:w().int().min(1).max(da).default(1),lineOpacity:w().int().min(0).max(100).default(100)}).strict();function Tl(t,e){const n=Math.min(e-1,Math.floor(t*e/256));return Math.floor((n*510+(e-1))/(2*(e-1)))}const Pl=(t,e)=>e===0?0:Math.min(255,Math.floor((510*t+e)/(2*e))),Rl=(t,e)=>Math.floor((2*t*e+255)/510),Ll=(t,e)=>{const o=(Math.min(255,t>>2)-e+1)*32;return o<0?0:o>255?255:o},Ln=(t,e)=>fa(t.blur,e),Ao=(t,e)=>2*Ln(t,e)+t.lineWidth+1;function Il(t,e,n,o){const r=t.apronPx,a=t.w,i=t.h,s=At(t),c=Ln(e,o.level),l=c>0?Fe(s,a,i,c,2):s,u=a*i,f=new Int32Array(u);for(let p=0;p<u;p++)f[p]=_e(l,p*4);const m=(p,g)=>p<0||g<0||p>=a||g>=i?255:f[g*a+p],d=new Uint8ClampedArray(u*4);let h=new Uint8ClampedArray(u);for(let p=0;p<i;p++)for(let g=0;g<a;g++){const _=p*a+g,y=m(g+1,p-1)+2*m(g+1,p)+m(g+1,p+1)-m(g-1,p-1)-2*m(g-1,p)-m(g-1,p+1),x=m(g-1,p+1)+2*m(g,p+1)+m(g+1,p+1)-m(g-1,p-1)-2*m(g,p-1)-m(g+1,p-1);h[_]=Ll(Math.abs(y)+Math.abs(x),e.threshold);const b=l[_*4+3];for(let M=0;M<3;M++)d[_*4+M]=Tl(Pl(l[_*4+M],b),e.colors)}for(let p=1;p<e.lineWidth;p++){const g=new Uint8ClampedArray(u);for(let _=0;_<i;_++)for(let y=0;y<a;y++){let x=0;for(let b=-1;b<=1;b++){const M=_+b;if(!(M<0||M>=i))for(let P=-1;P<=1;P++){const L=y+P;if(L<0||L>=a)continue;const I=h[M*a+L];I>x&&(x=I)}}g[_*a+y]=x}h=g}for(let p=0;p<n.h;p++)for(let g=0;g<n.w;g++){const _=(p+r)*a+g+r,y=s[_*4+3],x=p*n.stride+g*4;n.data[x+3]=y;const b=Math.floor((h[_]*e.lineOpacity+50)/100);for(let M=0;M<3;M++){const P=Math.floor((d[_*4+M]*(255-b)+127)/255);n.data[x+M]=y===0?0:Rl(P,y)}}}const Cl=`${Be}
uniform int u_colors;
uniform int u_thr;
int og_lum(ivec2 q) { return og_lumaOverWhite(og_src(q)); }
int og_post(int v) {
  int band = min(u_colors - 1, (v * u_colors) / 256);
  return (band * 510 + (u_colors - 1)) / (2 * (u_colors - 1));
}
void main() {
  ivec2 p = og_pixel();
  int gx = og_lum(p + ivec2(1, -1)) + 2 * og_lum(p + ivec2(1, 0)) + og_lum(p + ivec2(1, 1))
    - og_lum(p + ivec2(-1, -1)) - 2 * og_lum(p + ivec2(-1, 0)) - og_lum(p + ivec2(-1, 1));
  int gy = og_lum(p + ivec2(-1, 1)) + 2 * og_lum(p + ivec2(0, 1)) + og_lum(p + ivec2(1, 1))
    - og_lum(p + ivec2(-1, -1)) - 2 * og_lum(p + ivec2(0, -1)) - og_lum(p + ivec2(1, -1));
  int e = min(255, (abs(gx) + abs(gy)) >> 2);
  int m = clamp((e - u_thr + 1) * 32, 0, 255);
  ivec4 c = ivec4(og_i8(og_src(p)));
  ivec3 s = c.a == 0 ? ivec3(0) : min(ivec3(255), (510 * c.rgb + c.a) / (2 * c.a));
  fragColor = vec4(float(og_post(s.r)), float(og_post(s.g)), float(og_post(s.b)), float(m)) / 255.0;
}
`,Sl=`void main() {
  ivec2 p = og_pixel();
  vec4 c = og_src(p);
  float v = 0.0;
  for (int dy = -1; dy <= 1; dy++)
    for (int dx = -1; dx <= 1; dx++) v = max(v, og_src(p + ivec2(dx, dy)).a);
  fragColor = vec4(c.rgb, v);
}
`,ha=`uniform int u_opacity;
void main() {
  ivec2 p = og_pixel();
  ivec4 c = ivec4(og_i8(og_src(p)));
  int a = int(og_i8(og_orig(p)).a);
  if (a == 0) { fragColor = vec4(0.0); return; }
  int k = (c.a * u_opacity + 50) / 100;
  ivec3 s = (c.rgb * (255 - k) + 127) / 255;
  ivec3 o = (2 * s * a + 255) / 510;
  fragColor = vec4(vec3(o), float(a)) / 255.0;
}
`;function Dl(t,e){const n=Ln(t,e.level),o=[];for(let r=1;r<t.lineWidth;r++)o.push({frag:Sl,precision:"rgba8"});return[...n>0?$e(n,2):[],{frag:Cl,precision:"rgba8",uniforms:{u_colors:t.colors,u_thr:t.threshold}},...o,{frag:ha,uniforms:{u_opacity:t.lineOpacity}}]}const Ol={id:U("filters.illustrationStyle"),titleKey:v("filter.illustrationStyle"),category:"effect",params:F(El),meta:[xt("blur","param.illustration.blur",0,ma,1,{unit:"px"}),xt("colors","param.illustration.colors",2,32,1),xt("threshold","param.illustration.threshold",1,255,1),xt("lineWidth","param.illustration.lineWidth",1,da,1,{unit:"px"}),xt("lineOpacity","param.illustration.lineOpacity",0,100,1,{unit:"percent"})],preservesTransparency:!0,apronPx:t=>Ao(t,0),apronAt:Ao,gpu:{passes:[{frag:ha}],uniforms:t=>({u_opacity:t.lineOpacity})},gpuPlan:(t,e)=>Dl(t,e),cpu:Il,previewStrategy:"proxy",recordable:!0},ga=50,Fl=R({range:w().int().min(1).max(ga).default(5),transparency:w().int().min(0).max(100).default(50),darkness:w().int().min(0).max(100).default(50)}).strict(),fe=(t,e)=>Math.max(1,fa(t.range,e));function $l(t,e,n,o,r,a){if(e===0){r[a]=r[a+1]=r[a+2]=r[a+3]=0;return}const i=e>n?Math.min(255,Math.floor(510*(e-n)/e)):0,s=Math.floor((e*(25500-o.transparency*(255-i))+12750)/25500),c=25500-o.darkness*i;for(let l=0;l<3;l++){const u=Math.floor((t[l]*s*2+e)/(2*e));r[a+l]=Math.floor((u*c*2+25500)/51e3)}r[a+3]=s}function Bl(t,e,n,o){const r=t.apronPx,a=At(t),i=t.w*t.h,s=new Uint8ClampedArray(i*4);for(let l=0;l<i;l++)s[l*4]=s[l*4+1]=s[l*4+2]=s[l*4+3]=a[l*4+3];const c=Fe(s,t.w,t.h,fe(e,o.level),2);for(let l=0;l<n.h;l++)for(let u=0;u<n.w;u++){const f=((l+r)*t.w+u+r)*4;$l([a[f],a[f+1],a[f+2]],a[f+3],c[f],e,n.data,l*n.stride+u*4)}}const Nl=`void main() {
  float a = og_orig(og_pixel()).a;
  fragColor = vec4(a);
}
`,ko=`uniform int u_t;
uniform int u_b;
void main() {
  ivec2 p = og_pixel();
  ivec4 c = ivec4(og_i8(og_orig(p)));
  int a = c.a;
  if (a == 0) { fragColor = vec4(0.0); return; }
  int m = int(og_i8(og_src(p)).r);
  int E = a > m ? min(255, (510 * (a - m)) / a) : 0;
  int na = (a * (25500 - u_t * (255 - E)) + 12750) / 25500;
  int dk = 25500 - u_b * E;
  ivec3 t1 = (c.rgb * na * 2 + a) / (2 * a);
  ivec3 o = (t1 * dk * 2 + 25500) / 51000;
  fragColor = vec4(vec3(o), float(na)) / 255.0;
}
`,Eo=t=>({u_t:t.transparency,u_b:t.darkness}),Wl={id:U("filters.watercolorEdge"),titleKey:v("filter.watercolorEdge"),category:"effect",params:F(Fl),meta:[xt("range","param.watercolor.range",1,ga,1,{unit:"px"}),xt("transparency","param.watercolor.transparency",0,100,1,{unit:"percent"}),xt("darkness","param.watercolor.darkness",0,100,1,{unit:"percent"})],preservesTransparency:!0,apronPx:t=>2*fe(t,0),apronAt:(t,e)=>2*fe(t,e),gpu:{passes:[{frag:ko}],uniforms:t=>Eo(t)},gpuPlan:(t,e)=>[{frag:Nl,precision:"rgba8"},...$e(fe(t,e.level),2),{frag:ko,uniforms:Eo(t)}],cpu:Bl,previewStrategy:"proxy",recordable:!0},Ul=`uniform sampler2D u_lut;
void main() {
  ivec2 p = og_pixel() + ivec2(u_apron);
  ivec4 c = ivec4(og_i8(og_orig(p)));
  if (c.a <= 0) { fragColor = vec4(0.0); return; }
  ivec3 s = min(ivec3(255), (510 * c.rgb + c.a) / (2 * c.a));
  int na = int(og_i8(texelFetch(u_lut, ivec2(c.a, 0), 0)).a);
  ivec3 l = ivec3(
    int(og_i8(texelFetch(u_lut, ivec2(s.r, 0), 0)).r),
    int(og_i8(texelFetch(u_lut, ivec2(s.g, 0), 0)).g),
    int(og_i8(texelFetch(u_lut, ivec2(s.b, 0), 0)).b));
  ivec3 o = (2 * l * na + 255) / 510;
  fragColor = vec4(vec3(o), float(na)) / 255.0;
}
`,zl=t=>`${t}
void main() {
  ivec2 p = og_pixel() + ivec2(u_apron);
  ivec4 c = ivec4(og_i8(og_orig(p)));
  if (c.a <= 0) { fragColor = vec4(0.0); return; }
  vec3 s = vec3(min(ivec3(255), (510 * c.rgb + c.a) / (2 * c.a))) / 255.0;
  vec3 f = clamp(og_correction(s), 0.0, 1.0);
  fragColor = vec4(floor(f * float(c.a) + 0.5), float(c.a)) / 255.0;
}
`,Gl=t=>Int32Array.from(t);function Xl(t){const e=t.lut?Ul:t.glsl?zl(t.glsl):null,n=(r,a)=>t.lut?{u_lut:Gl(t.lut(r))}:t.uniforms?t.uniforms(r):{};return{id:U(di(t.id)),titleKey:t.titleKey,category:"correction",params:t.params,meta:t.meta,apronPx:()=>0,apronAt:()=>0,...e?{gpu:{passes:[{frag:e}],uniforms:n}}:{},cpu:(r,a,i)=>{const s=r.apronPx,c=t.lut?t.lut(a):null;for(let l=0;l<i.h;l++){const u=(l+s)*r.stride+s*4,f=r.data.subarray(u,u+i.w*4),m=i.data.subarray(l*i.stride,l*i.stride+i.w*4);c?ir(f,c,m):sr(f,t,a,m)}},previewStrategy:"proxy",recordable:!0}}const In=[Pr,Lr,wc,Rr,pc,Tc,Ir,Dr,Fr,Cc];if(In.length!==cc.length+4)throw new Error("filters: correction list out of sync");const pa=In.map(t=>Xl(t)),gn=[ss],Re=[Ki,Vi,Fi,ji,ws,Es,Yi,Hi,Is,ns,Ol,Wl,xl,kl,pl,Yc,Jc,tl,ll,ul,$s,Gs,js,...gn,...pa];let oe=null;function ya(){if(!oe){oe=new Map;for(const t of Re)oe.set(t.id,t)}return oe}const _a="filters.cpu";function va(t,e,n,o=r=>ya().get(r)){const r=o(t.filterId);if(!r?.cpu)throw new Error(`filters: no cpu implementation for "${t.filterId}"`);const a=t.w-2*t.apron,i=t.h-2*t.apron,s=new Uint8ClampedArray(Math.max(0,a)*Math.max(0,i)*4);if(a<=0||i<=0)return s;const c={docId:t.ctx.docId,rect:t.ctx.rect,selection:{kind:"none"},level:t.ctx.level,frame:t.ctx.frame,dpi:t.ctx.dpi,gpu:null,kernels:e,point:t.ctx.point,signal:n,...t.ctx.canvas?{canvas:t.ctx.canvas}:{},...t.ctx.edgeMode?{edgeMode:t.ctx.edgeMode}:{}};return r.cpu({data:t.data,w:t.w,h:t.h,stride:t.w*4,premultiplied:!0,key:t.key,origin:t.origin,apronPx:t.apron},t.params,{data:s,w:a,h:i,stride:a*4,premultiplied:!0,key:t.key,origin:t.origin,apronPx:0},c),s}const ql={[_a]:(t,{signal:e})=>va(t,Do,e)},Kl=t=>t.preservesTransparency??(t.category!=="render"&&t.category!=="effect"),Vl=4*C;function To(t){return Math.min(8,Math.max(1,Math.ceil(2*t/C)))*C}function jl(t){return t.kind==="mask"?t.bounds:null}function xa(t){let e=t.canvas;const n=t.plugin.apronPx(t.params),o=t.store.format==="a8"&&t.a8Missing===255;if(Kl(t.plugin)&&!o){const a=t.store.bounds();if(!a)return null;e=H(e,Xo(a,n))}const r=jl(t.selection);return e&&r&&(e=H(e,r)),t.selection.kind==="mask"&&!r?null:e}function wa(t,e,n,o){if(!t.singleRegion)return;const r=t.singleRegion(e,{w:n.w,h:n.h},o);return r?H(r,n):null}const Yl=()=>{const t=new Error("filters: aborted");return t.name="AbortError",t};class ba{constructor(e){this.env=e}async runRegion(e,n,o,r,a,i,s=this.env.backend??"auto"){const c={x:r.x+a,y:r.y+a,w:r.w-2*a,h:r.h-2*a},l={tx:Math.floor(c.x/C),ty:Math.floor(c.y/C)},u=i.signal??new AbortController().signal,f=this.env.gpu,m=s!=="cpu"&&f!==null&&!f.lost.value&&Kn(e);if(s==="gpu"&&!m)throw new vt(f?"plugin has no gpu path or context lost":"no GPU context");if(m)try{const p={...i,rect:c,kernels:this.env.kernels,gpu:f,signal:u};return{data:await Mi(f,e,n,Ei(o,r,a,l),p),backend:"gpu"}}catch(p){if(s==="gpu")throw p}if(!e.cpu)throw new Error(`filters: ${e.id} has no cpu implementation and the GPU path failed`);const d={filterId:e.id,params:n,data:o,w:r.w,h:r.h,apron:a,origin:{x:c.x,y:c.y},key:l,ctx:{docId:i.docId,rect:c,level:i.level,frame:i.frame,dpi:i.dpi,point:i.point,...i.canvas?{canvas:i.canvas}:{},...i.edgeMode?{edgeMode:i.edgeMode}:{}}};return this.env.workers&&ya().get(e.id)===e?{data:await this.env.workers.run(_a,d,[o.buffer],u),backend:"cpu"}:{data:va(d,this.env.kernels,u,()=>e),backend:"cpu"}}async apply(e){const n=e.plugin,o=e.params,r=e.store,a=r.format==="a8",i=a?e.a8Missing??0:0,s=xa(e);if(!s)return{next:r,entries:[],backend:"none",rect:null};const c=wa(n,o,e.canvas,e.point);if(c===null)return{next:r,entries:[],backend:"none",rect:null};const l=c?Yo:n.apronPx(o),u=this.env.gpu,f=u!==null&&!u.lost.value&&(this.env.backend??"auto")!=="cpu"&&Kn(n),m=f?Math.max(Vl,To(l)):To(l),d=Math.floor(s.x/m),h=Math.floor(s.y/m),p=Math.floor((s.x+s.w-1)/m),g=Math.floor((s.y+s.h-1)/m),_=[];if(c)_.push(c);else for(let A=h;A<=g;A++)for(let B=d;B<=p;B++){const W=H({x:B*m,y:A*m,w:m,h:m},s);W&&_.push(W)}const y=new Map,x=[];let b="none";const M={docId:e.docId,selection:e.selection,level:0,frame:e.frame,dpi:e.dpi,point:e.point,canvas:e.canvas,edgeMode:e.edgeMode??"zero",...e.signal?{signal:e.signal}:{}};let P=0;const L=async A=>{if(e.signal?.aborted)throw Yl();const B=Xo(A,l),W=await De(r,B,e.canvas,{missing:i,edgeMode:e.edgeMode??"zero"}),N=new Uint8ClampedArray(A.w*A.h*4);nn(W,B,N,A,4);const V=await this.runRegion(n,o,W,B,l,M);b=b==="none"||b===V.backend?V.backend:"mixed";const S=V.data;e.lockAlpha&&!a&&Vo(N,S);const D=Oo({data:N,w:A.w,h:A.h,stride:A.w*4,premultiplied:!0},{data:S,w:A.w,h:A.h,stride:A.w*4},e.selection,{x:A.x,y:A.y}).data;for(const X of Se(A)){const q=vn(X),T=r.get(X)??null,j=await Hl(T,a,i),J=new Uint8ClampedArray(j);if(a){const z=H(q,A);for(let tt=z.y;tt<z.y+z.h;tt++){let lt=((tt-A.y)*A.w+(z.x-A.x))*4+3,Pt=(tt-q.y)*C+(z.x-q.x);for(let et=0;et<z.w;et++,lt+=4,Pt++)J[Pt]=D[lt]}}else nn(D,A,J,q,4);if(Ql(j,J))continue;const ct=Zl(a,J,i);ct===null&&T===null||(y.set(Fo(X),ct),x.push({key:X,before:T,after:ct}))}P++,e.progress?.(P/_.length)},I=f?1:Math.max(1,Math.min(4,this.env.workers?.size??1));let O=0;const $=[];for(let A=0;A<Math.min(I,_.length);A++)$.push((async()=>{for(;O<_.length;){const B=_[O++];await L(B)}})());return await Promise.all($),y.size===0?{next:r,entries:[],backend:b,rect:s}:{next:r.with(y),entries:x,backend:b,rect:s}}}async function Hl(t,e,n){const o=C*C*(e?1:4);if(!t){const a=new Uint8ClampedArray(o);return e&&n&&a.fill(n),a}return(t.tryCpu()??await t.cpu()).data}function Ql(t,e){if(t.length!==e.length)return!1;for(let n=0;n<t.length;n++)if(t[n]!==e[n])return!1;return!0}function Zl(t,e,n){if(t){let o=!0;for(let r=0;r<e.length;r++)if(e[r]!==n){o=!1;break}if(o)return null}return tn().refFromData(t?"a8":"rgba8",e,!1)}function Jl(){if(typeof Worker>"u")throw new Error("filters: Worker is not available in this environment");return new Worker(new URL("/paint/assets/filters.worker-DsKeJjzT.js",import.meta.url),{type:"module",name:"og-filters"})}const Po=new WeakMap;function Et(t){let e=Po.get(t);if(!e){let n;e={last:null,lastParams:new Map,dialogOpen:!1,pendingPreview:null,backend:"auto",edgeMode:"zero",workers(){if(n!==void 0)return n;if(n=null,typeof Worker=="function"&&typeof window<"u")try{const o=typeof navigator<"u"?navigator.hardwareConcurrency||4:2;n=ui({createWorker:Jl,local:ql,size:Math.max(1,Math.min(4,o-1))})}catch{n=null}return n},dispose(){n?.dispose?.(),n=void 0}},Po.set(t,e)}return e}function Bt(t,e){const n=e.editTarget;if(!n)return{ok:!1,reason:dt.noTarget};const o=Mt.find(t,n.layerId);if(!o)return{ok:!1,reason:dt.noTarget};if(Mt.effectiveLocked(t,o.id))return{ok:!1,reason:dt.locked};if(n.part==="mask"){const r=o.mask;return r?{ok:!0,target:n,node:o,store:r.tiles,a8Missing:r.defaultValue,lockAlpha:!1}:{ok:!1,reason:dt.noTarget}}return o.kind!=="raster"?{ok:!1,reason:dt.notRaster}:{ok:!0,target:n,node:o,store:o.tiles,a8Missing:0,lockAlpha:o.lockAlpha}}function Ma(t){const e=Et(t);return{kernels:t.services.tryGet("kernels")??Do,gpu:e.backend==="cpu"?null:t.services.tryGet("gpuContext")??null,workers:e.workers(),backend:e.backend,edgeMode:e.edgeMode}}async function tu(t,e,n,o,r,a={}){const i=Bt(n,o);if(!i.ok)return{entry:null,error:i.reason};const c=await new ba(r).apply({plugin:t,params:e,store:i.store,a8Missing:i.a8Missing,canvas:{x:0,y:0,w:n.canvas.width,h:n.canvas.height},selection:n.selection,lockAlpha:i.lockAlpha,edgeMode:r.edgeMode??"zero",docId:n.id,dpi:n.canvas.dpi,frame:o.frame,point:t.resolvePoint?.(e,{w:n.canvas.width,h:n.canvas.height})??null,...a.signal?{signal:a.signal}:{},...a.progress?{progress:a.progress}:{}});if(c.entries.length===0)return{entry:null};let l;if(i.target.part==="mask"){const m=i.node.mask;l=Mt.patch(n,i.node.id,{mask:{...m,tiles:c.next}})}else l=Mt.patch(n,i.node.id,{tiles:c.next});const u={kind:"tiles",layerId:i.target.layerId,part:i.target.part,entries:c.entries};return{entry:$o({labelKey:t.titleKey,before:n,after:l,diffs:[u],focus:{before:i.target,after:i.target},recordable:!0})}}const eu=8,He=()=>typeof performance<"u"?performance.now():Date.now(),nu=()=>new Promise(t=>setTimeout(t,0));class ou{cache=new WeakMap;lastYield=He();computed=0;clear(){this.cache=new WeakMap}async maybeYield(){He()-this.lastYield<eu||(await nu(),this.lastYield=He())}async tileAt(e,n,o,r,a,i){const s=vn(n),c=H(s,a),l=!!c&&c.w===C&&c.h===C,u=l?`${r}`:`${r}@${a.x},${a.y},${a.w}x${a.h}`;let f=this.cache.get(e);const m=f?.get(u);if(m)return m;const d=await qo(e),h=new Uint8ClampedArray(C*C*4);if(o==="a8")for(let g=0,_=0;g<d.length;g++,_+=4){const y=d[g];h[_]=y,h[_+1]=y,h[_+2]=y,h[_+3]=y}else h.set(d.subarray(0,h.length));l||Vn(h,s,c,"zero",i);const p=r>0?jo(h,C,C,r).data:h;return this.computed++,f||(f=new Map,this.cache.set(e,f)),f.set(u,p),p}async read(e,n,o,r){const a=r.edgeMode??"zero",s=e.format==="a8"?r.missing??0:0;if(o<=0)return De(e,n,r.canvas,{missing:s,edgeMode:a});const c=1<<o,l=C/c,u={x:Math.floor(r.canvas.x/c),y:Math.floor(r.canvas.y/c),w:Math.ceil((r.canvas.x+r.canvas.w)/c)-Math.floor(r.canvas.x/c),h:Math.ceil((r.canvas.y+r.canvas.h)/c)-Math.floor(r.canvas.y/c)},f=new Uint8ClampedArray(n.w*n.h*4);s&&f.fill(s);const m=H(n,u);if(m){const d={x:m.x*c,y:m.y*c,w:m.w*c,h:m.h*c};for(const h of Se(d)){if(r.cancelled?.())return null;const p=e.get(h);if(!p)continue;const g=await this.tileAt(p,h,e.format,o,r.canvas,s),_={x:h.tx*l,y:h.ty*l,w:l,h:l},y=H(_,m);if(y)for(let x=y.y;x<y.y+y.h;x++){const b=((x-_.y)*l+(y.x-_.x))*4;f.set(g.subarray(b,b+y.w*4),((x-n.y)*n.w+(y.x-n.x))*4)}await this.maybeYield()}}return Vn(f,n,m,a,s),f}}const Ro=4*1024*1024,Aa=5;function ru(t){return!(t>0)||t>=1?0:Math.max(0,Math.min(Aa,Math.floor(Math.log2(1/t)+1e-9)))}function au(t){const e=t.screenSize.value;if(!(e.w>0&&e.h>0))return null;const n=[t.toCanvas({x:0,y:0}),t.toCanvas({x:e.w,y:0}),t.toCanvas({x:0,y:e.h}),t.toCanvas({x:e.w,y:e.h})],o=n.map(l=>l.x),r=n.map(l=>l.y),a=Math.floor(Math.min(...o))-1,i=Math.floor(Math.min(...r))-1,s=Math.ceil(Math.max(...o))+1,c=Math.ceil(Math.max(...r))+1;return{x:a,y:i,w:s-a,h:c-i}}function Qe(t,e){const n=1<<e,o=Math.floor(t.x/n),r=Math.floor(t.y/n);return{x:o,y:r,w:Math.ceil((t.x+t.w)/n)-o,h:Math.ceil((t.y+t.h)/n)-r}}function iu(t,e,n){if(t.w*t.h<=e)return t;const o=Math.max(1,Math.floor(Math.sqrt(e))),r=Math.min(Math.max(n.x,t.x),t.x+t.w),a=Math.min(Math.max(n.y,t.y),t.y+t.h);let i=Math.floor(r-o/2),s=Math.floor(a-o/2);return i=Math.max(t.x,Math.min(i,t.x+t.w-o)),s=Math.max(t.y,Math.min(s,t.y+t.h-o)),H(t,{x:i,y:s,w:o,h:o})}async function su(t,e,n,o,r){if(t.kind!=="mask"||n<=0)return t;const a=1<<n,i=t.offset.x,s=t.offset.y;let c;if(i%a===0&&s%a===0){const u={x:e.x-i/a,y:e.y-s/a,w:e.w,h:e.h},f=1<<30;c=await o.read(t.tiles,u,n,{canvas:{x:-f,y:-f,w:2*f,h:2*f},missing:0,...r?{cancelled:r}:{}})}else{const u={x:e.x*a-i,y:e.y*a-s,w:e.w*a,h:e.h*a};c=jo(await De(t.tiles,u,null),u.w,u.h,n).data}if(!c)return null;const l=new Uint8ClampedArray(e.w*e.h);for(let u=0,f=3;u<l.length;u++,f+=4)l[u]=c[f];return{kind:"mask",tiles:Ya("a8",l,e),bounds:e,offset:{x:0,y:0}}}function ka(t,e,n,o){let r=o,a=!0,i=0,s=Promise.resolve(),c=null,l=!1,u=!1,f=null;const m=new ou;let d=null;const h=()=>t.services.tryGet("compositor"),p=()=>{const M=t.services.tryGet("activeView");return M&&M.docId===n?M:void 0},g=()=>{c&&h()?.setOverlay("filterPreview",null),c=null,f=null},_=async M=>{const P=t.documents.session(n);if(!P)return;const L=P.store.current.value,I=P.store.session.value,O=Bt(L,I),$=h();if(!O.ok||!$||O.target.part!=="content"){g();return}const A=Ma(t),B=A.edgeMode??"zero",W={x:0,y:0,w:L.canvas.width,h:L.canvas.height};let N=xa({plugin:e,params:r,store:O.store,canvas:W,selection:L.selection,a8Missing:0});const V=p();let S=0,D=null;if(V&&(D=au(V),D&&N&&(N=H(N,D)),S=ru(V.transform.value.scale)),!N){g();return}const X=e.resolvePoint?.(r,{w:W.w,h:W.h})??null,q=wa(e,r,W,X);if(q===null){g();return}let T,j;if(q){for(;S<Aa;){const Y=Qe(q,S);if(Y.w*Y.h<=Ro)break;S++}T=Qe(q,S),j=Yo}else{const Y=1<<S,ut=D?{x:D.x+D.w/2,y:D.y+D.h/2}:{x:N.x+N.w/2,y:N.y+N.h/2};T=iu(Qe(N,S),Ro,{x:ut.x/Y,y:ut.y/Y}),j=e.apronAt?e.apronAt(r,S):Math.ceil(e.apronPx(r)/Y)}const J=1<<S,ct={x:T.x-j,y:T.y-j,w:T.w+2*j,h:T.h+2*j},z=()=>M!==i||l,tt=await m.read(O.store,ct,S,{canvas:W,edgeMode:B,cancelled:z});if(!tt||z())return;const lt=new Uint8ClampedArray(T.w*T.h*4);for(let Y=0;Y<T.h;Y++){const ut=((Y+j)*ct.w+j)*4;lt.set(tt.subarray(ut,ut+T.w*4),Y*T.w*4)}const et=await new ba(A).runRegion(e,r,tt,ct,j,{docId:n,selection:L.selection,level:S,frame:I.frame,dpi:L.canvas.dpi,point:X,canvas:W,edgeMode:B});if(z())return;const pt=et.data;O.lockAlpha&&Vo(lt,pt);const yt=await su(L.selection,T,S,m,z);if(!yt||z())return;const Ga=Oo({data:lt,w:T.w,h:T.h,stride:T.w*4,premultiplied:!0},{data:pt,w:T.w,h:T.h,stride:T.w*4},yt,{x:T.x,y:T.y}).data;if(z()||!a)return;const Fn=new Map;for(const Y of Se(T)){const ut={x:Y.tx*C,y:Y.ty*C,w:C,h:C},Rt=H(ut,T),Bn=new Uint8ClampedArray(C*C*4);for(let Zt=Rt.y;Zt<Rt.y+Rt.h;Zt++){const Nn=((Zt-T.y)*T.w+(Rt.x-T.x))*4;Bn.set(Ga.subarray(Nn,Nn+Rt.w*4),((Zt-ut.y)*C+(Rt.x-ut.x))*4)}Fn.set(Fo(Y),tn().refFromData("rgba8",Bn,!1))}const Xa=tn().create("rgba8").with(Fn),$n={x:T.x*J,y:T.y*J,w:T.w*J,h:T.h*J};$.setOverlay("filterPreview",{anchor:{aboveLayerId:O.node.id},source:Xa,bounds:$n,blendMode:"normal",opacity:1,tint:null,transform:null,affectsExport:!1,replacesAnchor:!0,sourceLevel:S}),c=$n,f=S},y=()=>{if(l)return;const M=++i;if(!a){g();return}u||(u=!0,s=s.then(async()=>{u=!1,await _(Math.max(M,i))}).catch(P=>{u=!1,d=P,g()}))},x=[],b=p();if(b){let M=!0;const P=()=>{M||y()};x.push(b.transform.subscribe(P)),x.push(b.screenSize.subscribe(P)),M=!1}return y(),{update(M){r=M,y()},setEnabled(M){a=M,M?y():(i++,g())},idle:()=>s,shown:()=>c,level:()=>f,error:()=>d,dispose(){if(!l){l=!0,i++;for(const M of x)M();g(),m.clear()}}}}let Kt=null;const cu=new Qa,lu=new Ha;function uu(t){Kt=t}const Nt=()=>Kt?.filters??cu,Ze=()=>Kt?.corrections??lu;function Wt(){if(!Kt)throw new Error("filters: not registered (call register(ctx) first)");return Kt}const Xu={register(t){const e=Nt();e.get(t.id)!==t&&e.register(t)},get:t=>Nt().get(t),list:()=>Nt().list(),async run(t,e,n){const o=Wt();if(!Nt().get(t))throw new Error(`filters: unknown filter "${t}"`);if(o.documents.active.value!==n&&o.services.tryGet("documentManager")?.activate(n),o.documents.active.value!==n)throw new Error(`filters: document ${n} is not active`);await o.commandQueue.run(ht(t),{params:e})},preview(t,e,n){const o=Wt(),r=Nt().get(t);if(!r)throw new Error(`filters: unknown filter "${t}"`);return ka(o,r,n,r.params.parse(e))},async repeatLast(){await Wt().commandQueue.run(zo.repeatLast)},setBackend(t){Et(Wt()).backend=t},setEdgeMode(t){Et(Wt()).edgeMode=t}},qu={register(t){const e=Ze();e.get(t.id)!==t&&e.register(t)},get:t=>Ze().get(t),list:()=>Ze().list()},Ea=["r","g","b"],Xt=(t,e,n)=>t<e?e:t>n?n:t,Ta=t=>(299*t[0]+587*t[1]+114*t[2])/1e3;function fu(t,e,n){const o={...t},r=Ta(n);return Ea.forEach((a,i)=>{const s=Math.round(n[i]),c=t[`${a}InBlack`],l=t[`${a}InWhite`];if(e==="black")o[`${a}InBlack`]=Xt(s,0,Math.min(254,l-2));else if(e==="white")o[`${a}InWhite`]=Xt(s,Math.max(1,c+2),255);else{const u=Math.max(l,c+1),f=(s-c)/(u-c),m=t[`${a}OutBlack`],d=t[`${a}OutWhite`],h=d!==m?(r-m)/(d-m):.5;if(f>0&&f<1&&h>0&&h<1){const p=Math.log(f)/Math.log(h);o[`${a}Gamma`]=Xt(Math.round(p*100)/100,.1,9.99)}}}),o}const pn=.01;function mu(t,e){const o=[...t.filter(r=>Math.abs(r.x-e.x)>=pn),e].sort((r,a)=>r.x-a.x);for(;o.length>wn;){let r=-1,a=1/0;for(let i=1;i<o.length-1;i++){if(o[i]===e)continue;const s=Math.abs(o[i].x-e.x);s<a&&(a=s,r=i)}if(r<0)break;o.splice(r,1)}return o}function du(t,e,n){const o={...t},r=Ta(n)/255;return Ea.forEach((a,i)=>{const s=Xt(n[i]/255,0,1),c=t[a];let l;e==="black"?(l=[{x:s,y:0},...c.filter(u=>u.x>s+pn)],l.length<2&&l.push({x:1,y:1})):e==="white"?(l=[...c.filter(u=>u.x<s-pn),{x:s,y:1}],l.length<2&&l.unshift({x:0,y:0})):l=mu(c,{x:s,y:Xt(r,0,1)}),o[a]=l.slice(0,wn)}),o}function Pa(t,e,n){return{items:t.map(r=>({key:r.key,meta:r,get:()=>e[r.key],set:a=>n(r.key,typeof a=="object"&&a!==null&&"value"in a?a.value:a)}))}}function hu(t,e,n,o){const r={...e,[n]:o},a=t.params.safeParse(r);return a.success?a.data:null}const Qt={display:"flex",flexDirection:"column",gap:"8px",minWidth:"300px"},qe={display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap"};async function gu(t,e){const n=t.documents.session(e);if(!n)return null;const o=Bt(n.store.current.value,n.store.session.value);if(!o.ok||o.store.format!=="rgba8")return null;const r={r:new Uint32Array(256),g:new Uint32Array(256),b:new Uint32Array(256),lum:new Uint32Array(256)};for(const[,a]of o.store.entries()){const i=(a.tryCpu()??await a.cpu()).data;for(let s=0;s<i.length;s+=4){const c=i[s+3];if(c===0)continue;const l=d=>c===255?d:Math.min(255,Math.floor((510*d+c)/(2*c))),u=l(i[s]),f=l(i[s+1]),m=l(i[s+2]);r.r[u]++,r.g[f]++,r.b[m]++,r.lum[Math.floor((299*u+587*f+114*m+500)/1e3)]++}}return r}function Cn(t,e,n){const o=t.services.tryGet("activeView");if(!o||o.docId!==e)return null;const r=o.element.getBoundingClientRect();return o.toCanvas({x:n.x-r.left,y:n.y-r.top})}async function Ra(t,e,n){const o=t.documents.session(e);if(!o)return null;const r=o.store.current.value,a=Bt(r,o.store.session.value);if(!a.ok||a.store.format!=="rgba8")return null;const i=Math.floor(n.x),s=Math.floor(n.y);if(i<0||s<0||i>=r.canvas.width||s>=r.canvas.height)return null;const c=Math.floor(i/C),l=Math.floor(s/C),u=a.store.get({tx:c,ty:l});if(!u)return null;const f=(u.tryCpu()??await u.cpu()).data,m=((s-l*C)*C+(i-c*C))*4,d=f[m+3];if(d===0)return null;const h=p=>d===255?p:Math.min(255,Math.floor((510*p+d)/(2*d)));return[h(f[m]),h(f[m+1]),h(f[m+2]),d]}function La(t,e){const[n,o]=Ie(null);return he(()=>{let r=!0;return gu(t,e).then(a=>{r&&o(a)}),()=>{r=!1}},[t,e]),n}const pu=["black","gray","white"];function Ia(t){const e=Tt();return E("div",{class:"og-filters-pickers",role:"group",style:qe,children:pu.map(n=>E("span",{"data-pick":n,children:E(yn,{label:e(v(`dialog.pick.${n}`)),sample:async o=>{const r=Cn(t.ctx,t.docId,o);return r?await Ra(t.ctx,t.docId,r):null},onPick:o=>t.onPick(n,[o[0],o[1],o[2]])})},n))})}function Ca(t){const e=Tt();return E(Bo,{label:e(v("param.levels.channel")),value:t.value,options:t.values.map(n=>({value:n,label:e(v(`param.levels.channel.${n}`))})),onChange:t.onChange})}const Sa=(t,e)=>t?e==="rgb"?t.lum:t[e]:null;function yu(t){const e=t.values,n=La(t.ctx,t.docId),o=e.channel,r={inBlack:e[`${o}InBlack`],inWhite:e[`${o}InWhite`],gamma:e[`${o}Gamma`],outBlack:e[`${o}OutBlack`],outWhite:e[`${o}OutWhite`]};return E("div",{class:"og-filters-levels",style:Qt,children:[E(Ca,{value:o,values:qt,onChange:a=>t.setKey("channel",a)}),E(ti,{value:r,histogram:Sa(n,o),channel:o,onChange:a=>t.set({...e,[`${o}InBlack`]:a.inBlack,[`${o}InWhite`]:a.inWhite,[`${o}Gamma`]:a.gamma,[`${o}OutBlack`]:a.outBlack,[`${o}OutWhite`]:a.outWhite})}),E(Ia,{ctx:t.ctx,docId:t.docId,onPick:(a,i)=>t.set(fu(e,a,i))})]})}function _u(t){const e=Tt(),n=t.values,o=La(t.ctx,t.docId),r=n.channel,[a,i]=Ie(null);return E("div",{class:"og-filters-curves",style:Qt,children:[E(Ca,{value:r,values:qt,onChange:s=>t.setKey("channel",s)}),E(Ja,{label:e(v("param.curves.curve")),size:256,points:n[r],interpolation:"natural",endpoints:"free",histogram:Sa(o,r),channel:r,diagonal:!0,readout:!0,markers:a===null?[]:[a],onChange:s=>t.setKey(r,s.map(c=>({x:c.x,y:c.y})))}),E(Ia,{ctx:t.ctx,docId:t.docId,onPick:(s,c)=>{i(r==="rgb"?(299*c[0]+587*c[1]+114*c[2])/255e3:c[r==="r"?0:r==="g"?1:2]/255),t.set(du(n,s,c))}})]})}const Lo={mono:[{pos:0,r:0,g:0,b:0,a:255},{pos:1,r:255,g:255,b:255,a:255}],sepia:[{pos:0,r:38,g:20,b:8,a:255},{pos:.55,r:170,g:120,b:70,a:255},{pos:1,r:252,g:240,b:214,a:255}],dusk:[{pos:0,r:24,g:16,b:64,a:255},{pos:.45,r:200,g:70,b:110,a:255},{pos:1,r:255,g:214,b:150,a:255}],cool:[{pos:0,r:8,g:24,b:48,a:255},{pos:.5,r:60,g:140,b:180,a:255},{pos:1,r:230,g:250,b:255,a:255}]};function vu(t){const e=ke(t),n=[];for(let o=0;o<=16;o++){const r=Math.min(255,o*16);n.push(`rgba(${e[r*4]},${e[r*4+1]},${e[r*4+2]},${(e[r*4+3]/255).toFixed(3)}) ${(r/255*100).toFixed(1)}%`)}return`linear-gradient(to right, ${n.join(", ")})`}function xu(t){if(t.length>=bn)return[...t];const e=[...t].sort((i,s)=>i.pos-s.pos);let n=.5,o=-1;for(let i=0;i<e.length-1;i++){const s=e[i+1].pos-e[i].pos;s>o&&(o=s,n=(e[i].pos+e[i+1].pos)/2)}const r=ke({stops:t,reverse:!1}),a=Math.round(n*255);return[...t,{pos:Math.round(n*1e3)/1e3,r:r[a*4],g:r[a*4+1],b:r[a*4+2],a:r[a*4+3]}]}function wu(t){const e=Tt(),n=t.values,o=a=>t.set({...n,stops:a}),r=(a,i)=>o(n.stops.map((s,c)=>c===a?{...s,...i}:s));return E("div",{class:"og-filters-gradient-map",style:Qt,children:[E("div",{class:"og-filters-gradient-map__bar",role:"img","aria-label":e(v("param.gradientMap.preview")),style:{height:"18px",background:vu(n)}}),E(Bo,{label:e(v("param.gradientMap.preset")),value:null,placeholder:e(v("param.gradientMap.preset")),options:Object.keys(Lo).map(a=>({value:a,label:e(v(`param.gradientMap.preset.${a}`))})),onChange:a=>o((Lo[a]??[]).map(i=>({...i})))}),E("ol",{class:"og-filters-gradient-map__stops",style:{listStyle:"none",margin:0,padding:0,display:"flex",flexDirection:"column",gap:"4px"},children:n.stops.map((a,i)=>E("li",{"data-stop":i,style:qe,children:[E(No,{label:e(v("param.gradientMap.color")),color:{rgb:[a.r,a.g,a.b]},onPick:s=>r(i,{r:s.rgb[0],g:s.rgb[1],b:s.rgb[2]})}),E("span",{class:"og-filters-gradient-map__hex",style:{minWidth:"64px",fontVariantNumeric:"tabular-nums"},children:Wo([a.r,a.g,a.b])}),E(ge,{label:e(v("param.gradientMap.position")),value:Math.round(a.pos*1e3)/10,min:0,max:100,step:1,baseUnit:"%",suffix:"%",decimals:1,onChange:s=>r(i,{pos:Math.min(1,Math.max(0,s/100))})}),E(ge,{label:e(v("param.gradientMap.opacity")),value:Math.round(a.a/255*100),min:0,max:100,step:1,baseUnit:"%",suffix:"%",decimals:0,onChange:s=>r(i,{a:Math.round(Math.min(100,Math.max(0,s))/100*255)})}),E(en,{disabled:n.stops.length<=2,onClick:()=>o(n.stops.filter((s,c)=>c!==i)),children:e(v("param.gradientMap.remove"))})]},i))}),E(en,{disabled:n.stops.length>=bn,onClick:()=>o(xu(n.stops)),children:e(v("param.gradientMap.add"))}),E(Za,{label:e(v("param.gradientMap.reverse")),checked:n.reverse,onChange:a=>t.setKey("reverse",a)})]})}function Da(t){const e=Pa(t.meta,t.values,(n,o)=>t.setKey(n,o));return E(Uo,{schema:e,ctx:{outputKind:"draw",inputKind:"none",layer:null,part:"content",target:null,settings:t.values},live:!0})}function Lt(t){const e=Tt(),n=t.values,o=t.ctx.documents.session(t.docId)?.store.current.value,r=n.centerX??(o?o.canvas.width/2:0),a=n.centerY??(o?o.canvas.height/2:0);return E("div",{class:"og-filters-radial",style:Qt,children:[E(Da,{...t,meta:t.plugin.meta}),E("div",{class:"og-filters-radial__center",style:qe,role:"group","aria-label":e(v("param.radialBlur.center")),children:[E(yn,{label:e(v("param.radialBlur.pickCenter")),sample:()=>[0,0,0,255],onPick:(i,s)=>{const c=s?Cn(t.ctx,t.docId,s):null;c&&t.set({...t.values,centerX:Math.round(c.x),centerY:Math.round(c.y)})}}),E(ge,{label:e(v("param.radialBlur.centerX")),value:Math.round(r),step:1,onChange:i=>t.setKey("centerX",Math.round(i))}),E(ge,{label:e(v("param.radialBlur.centerY")),value:Math.round(a),step:1,onChange:i=>t.setKey("centerY",Math.round(i))}),E(en,{onClick:()=>t.set({...t.values,centerX:null,centerY:null}),children:e(v("param.radialBlur.resetCenter"))})]})]})}function bu(t){const e=Tt(),n=t.values,o=r=>{const a=n[r];return E("div",{class:`og-filters-color-replace__${r}`,style:qe,"data-color":r,children:[E("span",{style:{minWidth:"96px"},children:e(v(`param.colorReplace.${r}`))}),E(No,{label:e(v(`param.colorReplace.${r}`)),color:{rgb:[a.r,a.g,a.b]},onPick:i=>t.set({...n,[r]:{r:i.rgb[0],g:i.rgb[1],b:i.rgb[2]}})}),E("span",{style:{minWidth:"64px",fontVariantNumeric:"tabular-nums"},children:Wo([a.r,a.g,a.b])}),r==="from"?E(yn,{label:e(v("param.colorReplace.pick")),sample:async i=>{const s=Cn(t.ctx,t.docId,i);return s?await Ra(t.ctx,t.docId,s):null},onPick:i=>t.set({...n,from:{r:i[0],g:i[1],b:i[2]}})}):null]})};return E("div",{class:"og-filters-color-replace",style:Qt,children:[o("from"),o("to"),E(Da,{...t,meta:t.plugin.meta})]})}const Mu={"filters.correction.levels":yu,"filters.correction.curves":_u,"filters.correction.gradientMap":wu,"filters.correction.colorReplace":bu,"filters.radialBlur":Lt,"filters.ripple":Lt,"filters.zigzag":Lt,"filters.spiral":Lt,"filters.fisheye":Lt,"filters.chromaticAberration":Lt};function Au(t){const[e,n]=Ie(t.initial),o=de(null);he(()=>{const u=setTimeout(()=>o.current?.focus(),0);return()=>clearTimeout(u)},[]);const r=u=>{n(u),t.onChange(u)},a=(u,f)=>{const m=hu(t.plugin,e,u,f);m!==null&&r(m)},i=u=>{const f=t.plugin.params.safeParse(u);f.success&&r(f.data)},s=Mu[t.plugin.id],c=Pa(t.plugin.meta,e,a),l={outputKind:"draw",inputKind:"none",layer:null,part:"content",target:null,settings:e};return E("div",{class:"og-filters-dialog","data-filter-id":t.plugin.id,ref:o,tabIndex:-1,children:s?E(s,{plugin:t.plugin,values:e,ctx:t.ctx,docId:t.docId,set:i,setKey:a}):t.plugin.meta.length>0?E(Uo,{schema:c,ctx:l,live:!0}):null})}async function ku(t,e,n,o){const r=t.services.tryGet("dialogs");let a=o,i=!0;const s=ka(t,e,n,o);if(!r)return{params:o,preview:s};const c={id:`filters.dialog.${e.id}`,titleKey:e.titleKey,modal:!0,backdrop:"clear",render(u,f,m){return Un(E(ei,{i18n:m.i18n,children:E(Au,{plugin:e,initial:o,ctx:t,docId:n,onChange:d=>{a=d,i&&s.update(d)}})}),u),{dispose(){Un(null,u)}}},ok:()=>({params:a}),preview:{initial:!0,onChange(u){i=u,u&&s.update(a),s.setEnabled(u)}}},l=await r.open(c);return l?{params:l.params,preview:s}:(s.dispose(),{params:null,preview:null})}const Eu=R({params:ni().optional()}).strict().optional();function Sn(t,e,n="warn"){t.services.tryGet("notify")?.toast(e,{level:n})}function Oa(t){const e=t.documents.activeSession();return e?Bt(e.store.current.value,e.store.session.value).ok:!1}async function Io(t,e,n,o){const r=Et(t);if(r.dialogOpen)return null;const a=t.documents.session(n);if(a){const i=Bt(a.store.current.value,a.store.session.value);if(!i.ok)return Sn(t,i.reason),null}r.dialogOpen=!0;try{const i=o?.params??r.lastParams.get(e.id),s=e.params.safeParse(i??{}),c=s.success?s.data:e.params.parse({}),l=await ku(t,e,n,c);return l.params===null?null:(Fa(t),r.pendingPreview=l.preview,{params:l.params})}finally{r.dialogOpen=!1}}function Fa(t){const e=Et(t),n=e.pendingPreview;e.pendingPreview=null,n?.dispose()}async function $a(t,e,n){const o=e.params.safeParse(n);if(!o.success)throw new Error(`filters: invalid params for ${e.id}: ${o.error.message}`);const r=await tu(e,o.data,t.doc,t.session,Ma(t.ctx),{signal:t.signal,progress:i=>t.progress(i,dt.progress)});if(r.error){Sn(t.ctx,r.error);return}const a=Et(t.ctx);return a.last={id:e.id,params:o.data},a.lastParams.set(e.id,o.data),r.entry?{entry:r.entry}:{applied:!0}}function Tu(t){const e=t;return{id:ht(t.id),titleKey:t.titleKey,argsSchema:Eu,recordable:!0,requires:"filter",when:Oa,interactive:{open:(n,o)=>Io(n.ctx,e,n.docId,o)},async run(n,o){try{let r=o;return(!r||r.params===void 0)&&(r=await Io(n.ctx,e,n.docId)??void 0,!r||r.params===void 0)?{applied:!1}:await $a(n,e,r.params)}finally{Fa(n.ctx)}}}}const Pu={id:zo.repeatLast,titleKey:dt.repeatLast,recordable:!1,requires:"filter",defaultKey:"Ctrl+KeyF",verifiedKey:!1,when:t=>Oa(t),async run(t){const n=Et(t.ctx).last,o=n?t.ctx.filters.get(n.id):void 0;if(!n||!o){Sn(t.ctx,dt.nothingToRepeat,"info");return}return $a(t,o,n.params)}},Ru=[...Re.map(t=>Tu(t)),Pu],me="filters.effect.extractLine",zt=16,Le=32,It=Object.freeze({blackThreshold:64,edgeThreshold:12,lineWidthPx:4,detectEdges:!0,fillBlack:!0}),Co=(t,e,n,o)=>{const r=typeof t=="number"&&Number.isFinite(t)?Math.round(t):o;return Math.max(e,Math.min(n,r))};function Dn(t){const e=typeof t=="object"&&t!==null?t:{},n=typeof e.lineWidthPx=="number"&&Number.isFinite(e.lineWidthPx)?Math.max(0,Math.min(100,e.lineWidthPx)):It.lineWidthPx;return{blackThreshold:Co(e.blackThreshold,0,255,It.blackThreshold),edgeThreshold:Co(e.edgeThreshold,0,255,It.edgeThreshold),lineWidthPx:n,detectEdges:typeof e.detectEdges=="boolean"?e.detectEdges:It.detectEdges,fillBlack:typeof e.fillBlack=="boolean"?e.fillBlack:It.fillBlack}}function On(t,e){const n=Math.round(t.lineWidthPx/2**Math.max(0,e|0));return Math.max(1,Math.min(zt,n))}function Lu(t,e){const n=255-t[e+3];return Math.floor((299*(t[e]+n)+587*(t[e+1]+n)+114*(t[e+2]+n)+500)/1e3)}function Iu(t,e,n){let o=0;if(n.detectEdges){const r=e-t-n.edgeThreshold+1;r>0&&(o=Math.min(255,Math.floor((r*255+Le/2)/Le)))}return n.fillBlack&&t<=n.blackThreshold&&(o=255),o}function Cu(t,e,n,o){const r=Dn(e),a=On(r,o?.level??0),i=t.apronPx,s=t.w,c=t.h,l=new Int32Array((s+1)*(c+1)),u=new Uint8Array(s*c);for(let d=0;d<c;d++){let h=0;const p=d*t.stride;for(let g=0;g<s;g++){const _=Lu(t.data,p+g*4);u[d*s+g]=_,h+=_,l[(d+1)*(s+1)+g+1]=l[d*(s+1)+g+1]+h}}const f=(2*a+1)*(2*a+1),m=s+1;for(let d=0;d<n.h;d++){const h=d+i;for(let p=0;p<n.w;p++){const g=p+i,_=u[h*s+g];let y=_;if(r.detectEdges){const M=g-a,P=h-a,L=g+a+1,I=h+a+1,O=Math.max(0,M),$=Math.max(0,P),A=Math.min(s,L),B=Math.min(c,I),W=l[B*m+A]-l[$*m+A]-l[B*m+O]+l[$*m+O],N=f-(A-O)*(B-$),V=W+255*N;y=Math.floor((V+(f>>1))/f)}const x=Iu(_,y,r),b=d*n.stride+p*4;n.data[b]=0,n.data[b+1]=0,n.data[b+2]=0,n.data[b+3]=x}}}const Su=`// 線画抽出（filters.effect.extractLine）。src/filters/effects/extract-line.ts の extractLineCpu と同じ整数の式
uniform int u_elRadius;
uniform int u_elEdge;
uniform int u_elBlack;
uniform int u_elDetect;
uniform int u_elFillBlack;
int el_luma(ivec2 p, ivec2 size) {
  if (p.x < 0 || p.y < 0 || p.x >= size.x || p.y >= size.y) return 255;
  ivec4 c = ivec4(floor(texelFetch(u_src, p, 0) * 255.0 + 0.5));
  ivec3 w = c.rgb + (255 - c.a);
  return (299 * w.r + 587 * w.g + 114 * w.b + 500) / 1000;
}
vec4 og_effect(sampler2D src, vec2 uv, vec2 texel, float apron) {
  ivec2 size = textureSize(src, 0);
  ivec2 p = ivec2(floor(uv / texel));
  int y = el_luma(p, size);
  int a = 0;
  if (u_elDetect != 0) {
    int r = u_elRadius;
    int sum = 0;
    for (int dy = -${zt}; dy <= ${zt}; dy++) {
      if (dy < -r || dy > r) continue;
      for (int dx = -${zt}; dx <= ${zt}; dx++) {
        if (dx < -r || dx > r) continue;
        sum += el_luma(p + ivec2(dx, dy), size);
      }
    }
    int n = (2 * r + 1) * (2 * r + 1);
    int b = (sum + n / 2) / n;
    int e = b - y - u_elEdge + 1;
    if (e > 0) a = min(255, (e * 255 + ${Le/2}) / ${Le});
  }
  if (u_elFillBlack != 0 && y <= u_elBlack) a = 255;
  return vec4(0.0, 0.0, 0.0, float(a) / 255.0);
}
`;function Du(t,e){const n=Dn(t);return{u_elRadius:On(n,e.level),u_elEdge:n.edgeThreshold,u_elBlack:n.blackThreshold,u_elDetect:n.detectEdges?1:0,u_elFillBlack:n.fillBlack?1:0}}const Je=Object.freeze({id:me,glsl:Su,uniforms:Du,apronPx:t=>{const e=Dn(t);return e.detectEdges?On(e,0):0},cpu(t,e,n,o){Cu(t,e,n,o)}}),Ba={set:ht("filters.layerEffect.extractLine"),toggle:ht("filters.layerEffect.extractLine.toggle")},rt={set:v("layerEffect.extractLine.set"),toggle:v("layerEffect.extractLine.toggle"),title:v("layerEffect.extractLine.title"),lineWidth:v("layerEffect.extractLine.lineWidth"),edgeThreshold:v("layerEffect.extractLine.edgeThreshold"),detectEdges:v("layerEffect.extractLine.detectEdges"),fillBlack:v("layerEffect.extractLine.fillBlack"),blackThreshold:v("layerEffect.extractLine.blackThreshold")},Ou=R({blackThreshold:w().int().min(0).max(255),edgeThreshold:w().int().min(0).max(255),lineWidthPx:w().min(0).max(100),detectEdges:Dt(),fillBlack:Dt()}).strict(),Na=ri(),Fu=R({ids:Ce(Na).optional(),value:Ou.nullable()}).strict(),$u=R({ids:Ce(Na).optional()}).strict().optional(),Ut=(t,e)=>({key:t,categoryId:"correction",labelKey:e,hasDynamics:!1,dynamicsAllowed:[],group:"extractLine"}),Ku=Object.freeze([{...Ut("detectEdges",rt.detectEdges),type:"boolean",groupLabelKey:rt.title},{...Ut("lineWidthPx",rt.lineWidth),type:"number",min:0,max:100,step:.5,unit:"px",display:"numeric",visibleWhen:t=>t.settings?.detectEdges!==!1},{...Ut("edgeThreshold",rt.edgeThreshold),type:"number",min:0,max:255,step:1,display:"numeric",visibleWhen:t=>t.settings?.detectEdges!==!1},{...Ut("fillBlack",rt.fillBlack),type:"boolean"},{...Ut("blackThreshold",rt.blackThreshold),type:"number",min:0,max:255,step:1,display:"numeric",visibleWhen:t=>t.settings?.fillBlack!==!1}]);function Wa(t){const e=t.documents.activeSession(),n=e?.store.session.value.editTarget;return e&&n?Mt.find(e.store.current.value,n.layerId):void 0}function Ua(t,e){const n=t.session.editTarget?.layerId??null,o=t.session.selectedLayerIds;return(e&&e.length?e:n&&o.length>1&&o.includes(n)?o:n?[n]:[]).map(a=>Mt.find(t.doc,a)).filter(a=>!!a&&a.kind!=="paper"&&a.id!==t.doc.root.id&&!Mt.effectiveLocked(t.doc,a.id))}const Bu=(t,e)=>JSON.stringify(t??null)===JSON.stringify(e??null);function za(t,e,n,o){let r=t.doc;const a=[];for(const i of e){const s=n(i);if(Bu(i.effects.extractLine,s))continue;const c={effects:{...i.effects,extractLine:s}};r=Mt.patch(r,i.id,c),a.push({t:"patch",id:i.id,patch:c})}if(a.length!==0)return{entry:$o({labelKey:o,before:t.doc,after:r,diffs:[oi(a)],focus:{before:t.session.editTarget,after:t.session.editTarget},recordable:!0})}}const Nu={id:Ba.set,titleKey:rt.set,argsSchema:Fu,recordable:!0,bindable:!1,requires:"edit",when:t=>Wa(t)!==void 0,run(t,e){return za(t,Ua(t,e.ids),()=>e.value,rt.set)}},Wu={id:Ba.toggle,titleKey:rt.toggle,argsSchema:$u,recordable:!0,requires:"edit",when:t=>{const e=Wa(t);return e!==void 0&&e.kind!=="paper"},run(t,e){const n=Ua(t,e?.ids),o=n.find(a=>a.id===t.session.editTarget?.layerId)??n[0];if(!o)return;const r=o.effects.extractLine===null;return za(t,n,a=>r?a.effects.extractLine??{...It}:null,rt.toggle)}},Uu=Object.freeze([Nu,Wu]),So=new WeakSet;function Vu(t){if(So.has(t))return;So.add(t),uu(t);for(const r of Re)t.filters.get(r.id)||t.filters.register(r);for(const r of In)t.corrections.get(r.id)||t.corrections.register(r);for(const r of Ru)t.commands.get(r.id)||t.commands.register(r);t.effects.get(me)||t.effects.register(Je);for(const r of Uu)t.commands.get(r.id)||t.commands.register(r);const e=t.services;if(e){const r=e.tryGet("compositor");r?r.registerEffect(me,Je):e.whenReady("compositor").then(a=>a.registerEffect(me,Je))}const n=new Map,o=new Set(gn.map(r=>r.id));for(const r of Re){if(r.category==="correction"||o.has(r.id))continue;const a=`filter.${r.category}`,i=n.get(a)??[];i.push({commandId:ht(r.id)}),n.set(a,i)}for(const[r,a]of n)t.menus.contribute(r,a,100);t.menus.contribute(Xn.editCorrection,[{labelKey:dt.correctionMenu,submenu:pa.map(r=>({commandId:ht(r.id)}))},...gn.map(r=>({commandId:ht(r.id)}))],100),t.menus.contribute(Xn.repeat,[{commandId:ht("filters.repeatLast")}],0)}export{st as CORRECTION_IDS,Ul as CORRECTION_LUT_FRAG,It as DEFAULT_EXTRACT_LINE,Ba as EXTRACT_LINE_CMD,me as EXTRACT_LINE_EFFECT_ID,Ku as EXTRACT_LINE_PARAM_META,_n as FILTER_IDS,Gu as applyCorrection,sr as applyCorrectionFn,ir as applyCorrectionLut,In as builtinCorrections,Re as builtinFilters,wc as colorBalance,vc as colorBalanceApply,Xl as correctionFilter,pa as correctionFilters,zl as correctionFnFrag,qu as corrections,mc as curveFn,mo as curveTable8,pc as curves,gc as curvesLut,du as curvesPick,Cu as extractLineCpu,Je as extractLineEffect,Ou as extractLineSpecSchema,Tu as filterCommand,Eu as filterCommandArgs,Ru as filterCommands,Xu as filterRegistry,Tc as gradientMap,kc as gradientMapPixel,ke as gradientTable,fu as levelsPick,Oe as lutFrom,Dn as normalizeExtractLine,Io as openInteractive,Vu as register,Pu as repeatLastCommand,Nu as setExtractLineCommand,Wu as toggleExtractLineCommand};
