// Benchmark-only: observe the actual workbench, never repair its layout.
// Timing/rounding policy is explicit so a stable wrong split cannot pass.
export const layoutProtocol = Object.freeze({ version: 1, timeoutMs: 6000, roundingCssPx: 1,
  stableCssPx: .5, consecutiveFrames: 2, target: 'two horizontal groups; native model and usable group widths' });
const finite = value => Number.isFinite(value);
function evaluateLayout(model, dom, sourceSize, readerExpected) {
  const failures = [], layout = model.layout, groups = [...(model.groups ?? [])].sort((a,b) => a.viewColumn-b.viewColumn);
  if (!layout || layout.orientation !== 0 || !Array.isArray(layout.groups) || layout.groups.length !== 2
      || layout.groups.some(group => group.groups?.length || !finite(group.size) || group.size <= 0)) failures.push('Native layout is not two finite horizontal leaf groups.');
  if (groups.length !== 2 || groups[0]?.viewColumn !== 1 || groups[1]?.viewColumn !== 2) failures.push('Native tab groups are not exactly columns One and Two.');
  const source = groups[0]?.activeTab, reader = groups[1]?.activeTab;
  if (source?.kind !== 'text' || source.uri !== model.sourceURI) failures.push('Column One does not display the exact native source text tab.');
  if (!model.visibleEditors?.some(editor => editor.uri === model.sourceURI && editor.viewColumn === 1)) failures.push('The exact source text editor is not visible in column One.');
  if (readerExpected) {
    if (reader?.kind !== 'custom' || reader.uri !== model.sourceURI || reader.viewType !== model.readerViewType || reader.viewType !== 'limr.reader') failures.push('Column Two does not display the matching LiMR custom editor.');
  } else if (reader || groups[1]?.tabs?.length) failures.push('Before opening the reader, the second group is unexpectedly occupied.');
  const boxes = dom.groups ?? [];
  if (boxes.length !== 2) failures.push('There are not exactly two visible native editor-group DOM boxes.');
  let metrics;
  if (boxes.length === 2) {
    const [a,b] = boxes, gap = b.rect.left-a.rect.right, usableWidth = a.rect.width+b.rect.width;
    if (boxes.some(box=>!['left','right','top','bottom','width','height'].every(key=>finite(box.rect[key])))) failures.push('A native group rectangle is non-finite.');
    if (!dom.editorArea || !finite(dom.editorArea.width) || Math.abs(a.rect.left-dom.editorArea.left)>1 || Math.abs(b.rect.right-dom.editorArea.right)>1) failures.push('The two groups do not cover the actual native editor area.');
    if (!finite(usableWidth) || usableWidth <= 0 || !finite(gap)) failures.push('Native group geometry is not finite and positive.');
    if (Math.abs(a.rect.top-b.rect.top)>1 || Math.abs(a.rect.bottom-b.rect.bottom)>1) failures.push('Native group boxes are not side-by-side with the same vertical bounds.');
    // A sash may overlay the group edges (gap=0) or occupy actual space.
    // Exclude only the observed between-box gap from usable width; it never
    // becomes a broad percentage/pixel tolerance on the requested ratio.
    const actualSash = Math.max(0,...dom.sashes.filter(sash => sash.rect.left <= b.rect.left+1 && sash.rect.right >= a.rect.right-1
      && sash.rect.top < Math.min(a.rect.bottom,b.rect.bottom) && sash.rect.bottom > Math.max(a.rect.top,b.rect.top)).map(sash=>sash.rect.width));
    if (gap < -1 || gap > actualSash+1) failures.push('Native groups overlap or have an unexplained gap beyond the measured sash.');
    if (!a.monaco.length) failures.push('Source group has no visible native Monaco editor.');
    const targetSourceWidth = sourceSize*usableWidth, sourceDelta = a.rect.width-targetSourceWidth;
    if (Math.abs(sourceDelta)>layoutProtocol.roundingCssPx) failures.push('Actual source group width did not reach the requested split (1 CSS px rounding allowance).');
    let modelRatio, modelTargetDelta, modelDomDelta;
    if (layout?.groups?.length===2 && layout.groups.every(group=>finite(group.size)&&group.size>0)) {
      modelRatio = layout.groups[0].size/(layout.groups[0].size+layout.groups[1].size);
      modelTargetDelta = (modelRatio-sourceSize)*usableWidth;
      modelDomDelta = modelRatio*usableWidth-a.rect.width;
      if (Math.abs(modelTargetDelta)>1) failures.push('Native layout model did not reach the requested ratio.');
      if (Math.abs(modelDomDelta)>1) failures.push('Native model and actual group widths disagree.');
    }
    metrics = { usableWidth, gap, observedSashWidth:actualSash, targetSourceWidth, sourceDelta, modelRatio, modelTargetDelta, modelDomDelta };
    if (readerExpected) {
      const frame = dom.readerFrame, root = dom.readerRoot;
      if (!frame || !root || !['width','height','x','y'].every(key=>finite(root[key])&&finite(frame[key]))) failures.push('Actual reader frame/root geometry is missing or non-finite.');
      else {
        if (Math.abs(frame.x-b.rect.left)>1 || Math.abs(frame.width-b.rect.width)>1 || frame.y < b.rect.top-1 || frame.y+frame.height > b.rect.bottom+1) failures.push('Observed reader frame is not contained in the matching second native group.');
        if (Math.abs(root.width-frame.width)>1) failures.push('Reader root width disagrees with its actual outer frame.');
      }
    }
  }
  return { valid: failures.length===0, failures, metrics };
}
async function domSnapshot(page, frame) {
  const dom = await page.evaluate(() => {
    const rect = element => { const r=element.getBoundingClientRect(); return {x:r.x,y:r.y,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}; };
    const visible = element => { const r=element.getBoundingClientRect(),s=getComputedStyle(element); return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'; };
    const scope = document.querySelector('.monaco-workbench .part.editor');
    return {at:performance.now(),timeOrigin:performance.timeOrigin,viewport:{width:innerWidth,height:innerHeight},editorArea:scope?rect(scope):null,
      groups:scope ? [...scope.querySelectorAll('.editor-group-container')].filter(visible).map(element=>({
        id:element.getAttribute('data-group-id'),rect:rect(element),
        monaco:[...element.querySelectorAll('.monaco-editor')].filter(visible).map(editor=>({rect:rect(editor),uri:editor.getAttribute('data-uri'),label:editor.getAttribute('aria-label')})),
      })).sort((a,b)=>a.rect.left-b.rect.left) : [],
      sashes:scope ? [...scope.querySelectorAll('.monaco-sash.vertical')].filter(visible).map(element=>({rect:rect(element)})) : []};
  });
  if (frame) {
    let outer=frame;
    while (outer.parentFrame() && outer.parentFrame()!==page.mainFrame()) outer=outer.parentFrame();
    const handle=await outer.frameElement();
    try { dom.readerFrame=await handle.boundingBox(); } finally { await handle.dispose(); }
    dom.readerRoot=await frame.evaluate(()=> { const r=document.querySelector('.lv-scroll')?.getBoundingClientRect(); return r ? {width:r.width,height:r.height,x:r.x,y:r.y} : null; });
  }
  return dom;
}
function stable(a,b) {
  if (a.groups.length!==2 || b.groups.length!==2) return false;
  const fields=['left','right','top','bottom'];
  return a.groups.every((group,index)=> group.id===b.groups[index].id && fields.every(key=>Math.abs(group.rect[key]-b.groups[index].rect[key])<=layoutProtocol.stableCssPx))
    && (!a.readerFrame&&!b.readerFrame || a.readerFrame&&b.readerFrame&&['x','y','width','height'].every(key=>Math.abs(a.readerFrame[key]-b.readerFrame[key])<=layoutProtocol.stableCssPx));
}
export async function waitForWorkbenchLayout({page,frame,host,sourceSize,readerExpected=true,evidence}) {
  if (!finite(sourceSize) || sourceSize<=0 || sourceSize>=1) throw new Error('A finite split ratio in (0,1) is required.');
  Object.assign(evidence,{protocol:layoutProtocol,sourceSize,readerExpected,startedAt:Date.now(),valid:false,samples:[]});
  const deadline=evidence.startedAt+layoutProtocol.timeoutMs;
  let active=true,timer;
  const expired=()=> { evidence.finishedAt=Date.now(); evidence.error='The requested native group identities/model/DOM split did not become stable within 6000 ms.'; return new Error(evidence.error); };
  const work=async()=> {
    while (active && Date.now()<deadline) {
      const sample={startedAt:Date.now()}; evidence.samples.push(sample);
      try {
        const model=await host('readWorkbenchLayout'); if (!active) return; sample.model=model;
        await page.evaluate(()=>new Promise(requestAnimationFrame)); if (!active) return;
        const first=await domSnapshot(page,frame); if (!active) return; sample.first=first;
        await page.evaluate(()=>new Promise(requestAnimationFrame)); if (!active) return;
        const second=await domSnapshot(page,frame); if (!active) return; sample.second=second;
        sample.firstCheck=evaluateLayout(model,first,sourceSize,readerExpected);
        sample.secondCheck=evaluateLayout(model,second,sourceSize,readerExpected);
        sample.stable=stable(first,second); sample.finishedAt=Date.now();
        if (sample.firstCheck.valid && sample.secondCheck.valid && sample.stable && sample.finishedAt<=deadline) {
          evidence.valid=true; evidence.observedAt=sample.finishedAt;
          evidence.actual={model,dom:second,metrics:sample.secondCheck.metrics}; return evidence;
        }
      } catch(error) { if (!active) return; sample.error=error.stack??String(error); }
      if (Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50));
    }
    if (active) throw expired();
  };
  try {
    return await Promise.race([work(),new Promise((_,reject)=> { timer=setTimeout(()=> { active=false; reject(expired()); },layoutProtocol.timeoutMs); })]);
  } finally { active=false; clearTimeout(timer); }
}
