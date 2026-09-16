const $ = id => document.getElementById(id);

let selectedBlob = null;
let recordingStream = null;
let audioContext = null;
let processor = null;
let sourceNode = null;
let pcmChunks = [];
let recStart = 0;
let recTimer = null;
let lastQueryCurve = null;

function setStatus(msg, kind="") {
  const el = $("status");
  el.className = "status " + kind;
  el.textContent = msg;
}

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".pane").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    $(btn.dataset.target).classList.add("active");
    if (btn.dataset.target === "libraryPane") loadLibrary();
  });
});

$("audioFile").addEventListener("change", () => {
  const f = $("audioFile").files[0];
  if (!f) return;
  selectedBlob = f;
  $("preview").src = URL.createObjectURL(f);
  $("preview").classList.remove("hidden");
  setStatus("Đã chọn tệp: " + f.name, "ok");
});

function wavFromFloat32(chunks, sampleRate) {
  let length = chunks.reduce((s, c) => s + c.length, 0);
  let samples = new Float32Array(length), offset = 0;
  chunks.forEach(c => { samples.set(c, offset); offset += c.length; });

  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (o,s) => { for(let i=0;i<s.length;i++) view.setUint8(o+i,s.charCodeAt(i)); };
  writeStr(0,"RIFF"); view.setUint32(4,36+samples.length*2,true);
  writeStr(8,"WAVE"); writeStr(12,"fmt "); view.setUint32(16,16,true);
  view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true); view.setUint16(34,16,true);
  writeStr(36,"data"); view.setUint32(40,samples.length*2,true);

  let p=44;
  for(let i=0;i<samples.length;i++,p+=2){
    let s=Math.max(-1,Math.min(1,samples[i]));
    view.setInt16(p,s<0?s*0x8000:s*0x7fff,true);
  }
  return new Blob([view],{type:"audio/wav"});
}

$("recordBtn").addEventListener("click", async () => {
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({audio:true});
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioContext.createMediaStreamSource(recordingStream);
    processor = audioContext.createScriptProcessor(4096,1,1);
    pcmChunks = [];
    processor.onaudioprocess = e => pcmChunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    sourceNode.connect(processor);
    processor.connect(audioContext.destination);

    recStart = Date.now();
    recTimer = setInterval(() => {
      const sec = Math.floor((Date.now()-recStart)/1000);
      $("recTime").textContent =
        String(Math.floor(sec/60)).padStart(2,"0")+":"+String(sec%60).padStart(2,"0");
    },250);

    $("recordBtn").disabled = true;
    $("stopBtn").disabled = false;
    setStatus("Đang thu âm…");
  } catch(e) {
    setStatus("Không truy cập được microphone: "+e.message,"error");
  }
});

$("stopBtn").addEventListener("click", async () => {
  clearInterval(recTimer);
  if (processor) processor.disconnect();
  if (sourceNode) sourceNode.disconnect();
  if (recordingStream) recordingStream.getTracks().forEach(t=>t.stop());

  selectedBlob = wavFromFloat32(pcmChunks,audioContext.sampleRate);
  await audioContext.close();
  $("preview").src = URL.createObjectURL(selectedBlob);
  $("preview").classList.remove("hidden");
  $("recordBtn").disabled = false;
  $("stopBtn").disabled = true;
  setStatus("Đã thu xong. Có thể phân tích ngay.","ok");
});

function drawCurve(canvasId, curve, referenceCurve=null) {
  const c=$(canvasId),ctx=c.getContext("2d");
  ctx.clearRect(0,0,c.width,c.height);
  ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);

  const all=[...(curve?.rel_pitch||[]),...(referenceCurve?.rel_pitch||[])];
  if(!all.length)return;
  let minY=Math.min(...all),maxY=Math.max(...all);
  if(maxY-minY<2){minY-=1;maxY+=1}
  const pad=42;

  ctx.strokeStyle="#e5e0d8";ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    const y=pad+(c.height-2*pad)*i/4;
    ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(c.width-pad,y);ctx.stroke();
  }

  function draw(ys,color,width){
    if(!ys?.length)return;
    ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();
    ys.forEach((v,i)=>{
      const x=pad+(c.width-2*pad)*(i/(ys.length-1||1));
      const y=c.height-pad-(c.height-2*pad)*((v-minY)/(maxY-minY));
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    });
    ctx.stroke();
  }

  draw(curve.rel_pitch,"#222",2.4);
  if(referenceCurve)draw(referenceCurve.rel_pitch,"#999",2.2);

  ctx.fillStyle="#666";ctx.font="12px sans-serif";
  ctx.fillText(maxY.toFixed(1)+" st",5,pad+4);
  ctx.fillText(minY.toFixed(1)+" st",5,c.height-pad+4);
}

$("searchBtn").addEventListener("click", async () => {
  const file=$("audioFile").files[0];
  const blob=selectedBlob||file;
  if(!blob){setStatus("Hãy thu âm hoặc chọn một tệp trước.","error");return}

  $("searchBtn").disabled=true;
  setStatus("Đang trích xuất cao độ và truy xuất kho tư liệu…");
  try{
    const fd=new FormData();
    fd.append("file",blob,blob.name||"recording.wav");
    const method=$("method").value,topK=$("topK").value;
    const res=await fetch(`/api/search?method=${encodeURIComponent(method)}&top_k=${topK}`,{
      method:"POST",body:fd
    });
    const data=await res.json();
    if(!res.ok)throw new Error(data.detail||"Lỗi xử lý");
    lastQueryCurve=data.query_curve;
    drawCurve("queryCanvas",data.query_curve);
    renderResults(data.results);
    setStatus("Hoàn tất. Phương pháp: "+data.method,"ok");
  }catch(e){setStatus(e.message,"error")}
  finally{$("searchBtn").disabled=false}
});

function esc(s){
  return String(s??"").replace(/[&<>"']/g,c=>(
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]
  ));
}

function renderResults(rows){
  const root=$("results");
  root.innerHTML="";
  root.className="";
  if(!rows.length){
    root.className="emptybox";
    root.textContent="Không có kết quả.";
    return;
  }

  rows.forEach((r,i)=>{
    const d=document.createElement("div");
    d.className="result";
    d.innerHTML=`
      <div class="rank">${i+1}</div>
      <div>
        <div class="result-title">${esc(r.title||r.id)}</div>
        <div class="meta">
          Nhóm: ${esc(r.variant_group||"—")}
          ${r.performer?" • "+esc(r.performer):""}
          ${r.location?" • "+esc(r.location):""}
          ${r.year?" • "+esc(r.year):""}
        </div>
        <div class="result-actions">
          <button class="linkbtn" data-id="${esc(r.id)}" data-title="${esc(r.title)}">
            So sánh đường giai điệu
          </button>
        </div>
      </div>
      <div class="score">${Number(r.similarity).toFixed(1)}<small>%</small></div>`;
    root.appendChild(d);
  });

  root.querySelectorAll(".linkbtn").forEach(b=>{
    b.addEventListener("click",()=>compareWith(b.dataset.id,b.dataset.title))
  });
}

async function compareWith(id,title){
  const res=await fetch(`/api/reference/${encodeURIComponent(id)}/contour`);
  const data=await res.json();
  if(!res.ok){setStatus(data.detail||"Không tải được bản tham chiếu","error");return}
  $("comparisonCard").classList.remove("hidden");
  $("comparisonTitle").textContent=
    title+" • "+(data.record.performer||"")+" • "+(data.record.location||"");
  drawCurve("compareCanvas",lastQueryCurve,data.curve);
  $("referenceAudio").src=`/api/reference/${encodeURIComponent(id)}/audio`;
  $("comparisonCard").scrollIntoView({behavior:"smooth",block:"start"});
}

async function loadLibrary(){
  const res=await fetch("/api/library"),data=await res.json();
  const tb=$("libraryBody");tb.innerHTML="";
  (data.records||[]).forEach(r=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${esc(r.id)}</td><td>${esc(r.title)}</td><td>${esc(r.variant_group)}</td>
      <td>${esc(r.performer)}</td><td>${esc(r.location)}</td><td>${esc(r.year)}</td><td>${esc(r.source)}</td>`;
    tb.appendChild(tr);
  });
}
$("refreshLibrary").addEventListener("click",loadLibrary);

$("loadEval").addEventListener("click", async()=>{
  const res=await fetch("/api/evaluation"),data=await res.json();
  const box=$("evalBox");box.innerHTML="";
  const names={
    rel_euclidean:"Relative + Euclidean",
    abs_dtw:"Absolute + DTW",
    rel_dtw:"Relative + DTW",
    ht_dtw:"HT-DTW"
  };
  const summary=data.summary||{};
  if(!Object.keys(summary).length){
    box.innerHTML='<div class="emptybox">Chưa có kết quả. Chạy <code>python -m app.evaluator</code> sau khi lập chỉ mục.</div>';
    return;
  }
  Object.entries(summary).forEach(([k,v])=>{
    const d=document.createElement("div");d.className="eval-card";
    d.innerHTML=`<b>${esc(names[k]||k)}</b>
      <div class="big">${(100*(v.top1_accuracy||0)).toFixed(1)}%</div>
      <small>Top-1</small>
      <p>R@3: ${(100*(v.recall_at_3||0)).toFixed(1)}%<br>
      R@5: ${(100*(v.recall_at_5||0)).toFixed(1)}%<br>
      Queries: ${v.queries||0}</p>`;
    box.appendChild(d);
  });
});


async function checkBackendHealth(){
  try {
    const res = await fetch("/api/health", {cache:"no-store"});
    const data = await res.json();
    if(!res.ok || !data.ok) throw new Error(data.detail || "Backend chưa sẵn sàng");
    console.info("HeritageTune API", data.version, data.platform, data.python);
  } catch(e) {
    setStatus("Máy chủ phân tích đang khởi động hoặc chưa được cấu hình. Nếu dùng Render Free, vui lòng chờ khoảng 30–90 giây rồi thử lại.", "error");
  }
}
checkBackendHealth();
