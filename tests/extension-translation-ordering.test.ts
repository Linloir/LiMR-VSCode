// Private host test: copy into the isolated candidate tests/ directory only.
// Uses the provider captured by the real activate() registration, no new export.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as VSCode from 'vscode';
import type { ReaderFileSettings } from '../src/shared/protocol';
const state=vi.hoisted(()=>{
  class Uri {
    scheme='file'; path:string; fsPath:string;
    constructor(readonly value:string){this.path=new URL(value).pathname;this.fsPath=this.path;}
    toString(){return this.value;}
    static parse(value:string){return new Uri(value);}
    static joinPath(base:Uri,...pieces:string[]){return new Uri(new URL(pieces.join('/'),base.value.replace(/\/?$/,'/')).href);}
  }
  const dispose=()=>({dispose(){}}),event=()=>dispose();
  return {receivers:new Map<string,(message:any)=>void>(),panels:new Map<string,any>(),viewChanges:new Map<string,()=>void>(),Uri,dispose,event,provider:undefined as unknown,documents:[] as any[],picks:[] as string[],pickers:[] as any[],editors:[] as any[],syncScroll:true,posts:[] as any[],updates:[] as any[],folderValues:new Map<string,unknown>(),workspaceValue:undefined as unknown,globalValue:'bilingual' as unknown,configBarrier:undefined as undefined|(()=>void),context:undefined as any};
});
vi.mock('vscode',()=>({
  Position:class { constructor(public line:number,public character:number){} },
  Uri:state.Uri,StatusBarAlignment:{Right:2},ConfigurationTarget:{Global:1,Workspace:2,WorkspaceFolder:3},
  TabInputCustom:class{},ColorThemeKind:{Light:1,HighContrast:3,HighContrastLight:4},
  env:{language:'en'},
  commands:{registerCommand:()=>state.dispose(),executeCommand:async()=>undefined},
  window:{
    registerCustomEditorProvider:(_name:string,provider:unknown)=>{state.provider=provider;return state.dispose();},
    createStatusBarItem:()=>({show(){},hide(){},dispose(){}}),
    showQuickPick:async(items:{value:string}[],options:unknown)=>{state.pickers.push({items,options});const value=state.picks.shift();if(value==='cancel')return undefined;const item=items.find(item=>item.value===value);if(!item)throw new Error('Unexpected native picker '+value);return item;},
    showErrorMessage:async(message:string)=>{throw new Error(message);},showInformationMessage:async()=>undefined,
    get visibleTextEditors(){return state.editors;},activeTextEditor:undefined,activeColorTheme:{kind:1},
    onDidChangeActiveColorTheme:state.event,onDidChangeActiveTextEditor:state.event,onDidChangeTextEditorSelection:state.event,onDidChangeWindowState:state.event,onDidChangeTextEditorVisibleRanges:state.event,
    tabGroups:{activeTabGroup:{activeTab:undefined},onDidChangeTabs:state.event},
  },
  workspace:{
    get textDocuments(){return state.documents;},isTrusted:true,fs:{isWritableFileSystem:()=>true},
    getWorkspaceFolder:(uri:InstanceType<typeof state.Uri>)=>({uri:state.Uri.parse('file:///'+uri.path.split('/')[1])}),
    getConfiguration:(_section:string,uri?:InstanceType<typeof state.Uri>)=>{
      const folder=uri?.path.split('/')[1],folderValue=folder&&state.folderValues.get(folder);
      return {get:(key:string,fallback:unknown)=>key==='translationMode'?(folderValue??state.workspaceValue??state.globalValue):key==='syncScroll'?state.syncScroll:fallback,
        inspect:(key:string)=>key==='translationMode'?{globalValue:state.globalValue,workspaceValue:state.workspaceValue,workspaceFolderValue:folderValue}:undefined,
        update:async(key:string,value:unknown,target:number)=>{state.configBarrier?.();state.updates.push({key,value,target});if(target===3&&folder)state.folderValues.set(folder,value);else if(target===2)state.workspaceValue=value;else state.globalValue=value;},};
    },
    asRelativePath:(uri:InstanceType<typeof state.Uri>)=>uri.path,
    createFileSystemWatcher:()=>({dispose(){},onDidChange:state.event,onDidCreate:state.event,onDidDelete:state.event}),
    onDidChangeTextDocument:state.event,onDidSaveTextDocument:state.event,onDidChangeConfiguration:state.event,onDidGrantWorkspaceTrust:state.event,
  },
}));
vi.mock('../src/skills',()=>({installSkill:async()=>{},installGlobalSkill:async()=>{},copySkillInstallPrompt:async()=>{},maybePromptSkillInstall:async()=>{},showSkillGuide:async()=>{}}));
vi.mock('../src/plugins',()=>({loadReaderPlugins:async()=>[],replacePluginResourceRoots:()=>[]}));
vi.mock('../src/plugin-registry',()=>({PluginRegistry:class{onDidChange=state.event;dispose(){}},createExtensionApi:()=>({})}));
vi.mock('../src/syntax-highlighting',()=>({SourceSyntaxHighlighting:class{dispose(){}}}));
vi.mock('../src/links',()=>({resolveReaderLink:()=>{throw new Error('Unexpected link use');}}));
vi.mock('../src/images',()=>({resolveReaderImage:()=>{throw new Error('Unexpected image use');}}));
import { activate } from '../src/extension';
interface Provider {
  resolveCustomTextEditor(document:VSCode.TextDocument,panel:VSCode.WebviewPanel):void;
  setFileSettings(uri:VSCode.Uri,incoming:ReaderFileSettings,replace?:boolean,epoch?:number,version?:number):Promise<void>;
  choosePreference(key:'translationMode',uri?:VSCode.Uri):Promise<void>;
  dispose():void;
}
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};};
let provider:Provider,values:Map<string,ReaderFileSettings>,writes:{key:string,value:ReaderFileSettings|undefined}[],blockNext:undefined|{entered:ReturnType<typeof deferred>,released:ReturnType<typeof deferred>};
function attach(path:string,visible=true){
  const uri=state.Uri.parse('file:///'+path) as unknown as VSCode.Uri;
  const document={uri,version:3,isDirty:false,languageId:'markdown',lineCount:1,offsetAt:()=>18,getText:()=> 'Unmodified source.'} as unknown as VSCode.TextDocument;
  state.documents.push(document);
  const webview={options:{},html:'',cspSource:'https://test.invalid',asWebviewUri:(value:unknown)=>value,onDidReceiveMessage:(callback:(message:any)=>void)=>{state.receivers.set(uri.toString(),callback);return state.dispose();},postMessage:async(message:unknown)=>{state.posts.push({uri:uri.toString(),message});return true;}};
  const panel={active:true,visible,webview,onDidChangeViewState:(callback:()=>void)=>{state.viewChanges.set(uri.toString(),callback);return state.dispose();},onDidDispose:state.event} as unknown as VSCode.WebviewPanel;
  state.panels.set(uri.toString(),panel);provider.resolveCustomTextEditor(document,panel);return document;
}
beforeEach(()=>{
  state.receivers.clear();state.panels.clear();state.viewChanges.clear();state.documents=[];state.picks=[];state.pickers=[];state.editors=[];state.syncScroll=true;state.posts=[];state.updates=[];state.folderValues.clear();state.workspaceValue=undefined;state.globalValue='bilingual';state.configBarrier=undefined;
  values=new Map();writes=[];blockNext=undefined;
  const context={subscriptions:[],extensionUri:state.Uri.parse('file:///extension'),asAbsolutePath:(path:string)=>'/extension/'+path,
    workspaceState:{get:(key:string,fallback:ReaderFileSettings)=>values.get(key)??fallback,update:async(key:string,value:ReaderFileSettings|undefined)=>{const held=blockNext;blockNext=undefined;if(held){held.entered.resolve();await held.released.promise;}writes.push({key,value:structuredClone(value)});if(value)values.set(key,structuredClone(value));else values.delete(key);}},};
  state.context=context;activate(context as unknown as VSCode.ExtensionContext);provider=state.provider as Provider;
});
afterEach(()=>{provider?.dispose();state.context?.subscriptions.forEach((item:{dispose():void})=>item.dispose());vi.useRealTimers();});

describe('native provisional translation write ordering (actual registered provider)',()=>{
  it('shows values, current mode and reset target first, then applies the chosen value to a file',async()=>{
    const document=attach('workspace/a.md'),key='limr.fileSettings:'+document.uri.toString();
    values.set(key,{translationMode:'original',typography:'justify'});
    state.picks=['translated','file'];await provider.choosePreference('translationMode',document.uri);
    expect(state.pickers[0].items.map((item:any)=>item.value)).toEqual(['bilingual','original','translated','paragraph','reset']);
    expect(state.pickers[0].items.find((item:any)=>item.value==='original').description).toBe('Current');
    expect(state.pickers[0].items.find((item:any)=>item.value==='reset').description).toBe('Default: Bilingual');
    expect(state.pickers[0].options.title).toContain('Current: Original only');
    expect(state.pickers[1].items.map((item:any)=>item.value)).toEqual(['file','default']);
    expect(state.pickers[1].options.title).toContain('Translation only');
    expect(values.get(key)).toEqual({translationMode:'translated',typography:'justify'});
    expect(state.updates).toEqual([]);
  });
  it('resets in one step and removes paragraph overrides while preserving other preferences',async()=>{
    const document=attach('workspace/a.md'),key='limr.fileSettings:'+document.uri.toString();
    values.set(key,{translationMode:'original',translationParagraphs:{first:'origin'},typography:'justify'});
    state.picks=['reset'];await provider.choosePreference('translationMode',document.uri);
    expect(state.pickers).toHaveLength(1);expect(values.get(key)).toEqual({typography:'justify'});
    expect(state.updates).toEqual([]);
  });
  it('cancelling either step leaves file and default preferences unchanged',async()=>{
    const document=attach('workspace/a.md');
    for(const picks of [['cancel'],['translated','cancel']]){
      state.picks=picks;await provider.choosePreference('translationMode',document.uri);
      expect(writes).toEqual([]);expect(state.updates).toEqual([]);
      expect(state.posts.filter(item=>item.message.type==='translationIntent')).toEqual([]);
    }
  });
  it('rejects a queued old completion after a same-value native default choice, before config write',async()=>{
    const document=attach('workspace/a.md'),held={entered:deferred(),released:deferred()};blockNext=held;
    const earlier=provider.setFileSettings(document.uri,{typography:'justify'});await held.entered.promise;
    const stale=provider.setFileSettings(document.uri,{translationMode:'paragraph',translationParagraphs:{old:'origin'}},false,0,3);
    state.picks=['bilingual','default'];state.configBarrier=()=>{expect(state.posts.some(item=>item.uri===document.uri.toString()&&item.message.type==='translationIntent'&&item.message.epoch===1)).toBe(true);};
    await provider.choosePreference('translationMode',document.uri);held.released.resolve();await Promise.all([earlier,stale]);
    expect(writes).toEqual([{key:'limr.fileSettings:'+document.uri.toString(),value:{typography:'justify'}}]);
    expect(values.get('limr.fileSettings:'+document.uri.toString())).toEqual({typography:'justify'});
  });
  it('rejects an already-queued completion if source version changes before its callback begins',async()=>{
    const document=attach('workspace/a.md'),held={entered:deferred(),released:deferred()};blockNext=held;
    const earlier=provider.setFileSettings(document.uri,{typography:'justify'});await held.entered.promise;
    const stale=provider.setFileSettings(document.uri,{translationMode:'paragraph',translationParagraphs:{old:'origin'}},false,0,3);
    (document as {version:number}).version=4;held.released.resolve();await Promise.all([earlier,stale]);
    expect(writes).toHaveLength(1);expect(values.get('limr.fileSettings:'+document.uri.toString())).toEqual({typography:'justify'});
  });
  it('advances all affected workspace-default readers before write, excluding folder and file overrides',async()=>{
    state.workspaceValue='bilingual';state.folderValues.set('protected','original');
    const first=attach('workspace/a.md'),second=attach('elsewhere/b.md'),folder=attach('protected/c.md'),file=attach('workspace/d.md');
    values.set('limr.fileSettings:'+file.uri.toString(),{translationMode:'original'});
    state.picks=['bilingual','default'];
    state.configBarrier=()=>{const notified=state.posts.filter(item=>item.message.type==='translationIntent').map(item=>item.uri).sort();expect(notified).toEqual([first.uri.toString(),second.uri.toString()].sort());};
    await provider.choosePreference('translationMode',first.uri);
    expect(state.updates).toEqual([{key:'translationMode',value:'bilingual',target:2}]);
    expect(state.posts.filter(item=>item.message.type==='translationIntent').every(item=>![folder.uri.toString(),file.uri.toString()].includes(item.uri))).toBe(true);
  });
});

describe('alignment after a completed source revision',()=>{
  function prepare(){
    const document=attach('workspace/scroll.md'),uri=document.uri.toString();
    (document as any).offsetAt=(position:{line:number})=>position.line*100;
    state.editors=[{document,visibleRanges:[{start:{line:3500}}]}];
    state.viewChanges.get(uri)!();state.posts=[];
    const complete=(version=document.version)=>state.receivers.get(uri)!({type:'loadProgress',progress:{uri,version,requestId:'completed',status:'ready',phase:'ready',percent:100}});
    return{document,uri,complete};
  }
  it('reads the latest viewport on completion, aligns once and ignores obsolete completions',()=>{
    const {document,uri,complete}=prepare();
    state.editors[0].visibleRanges[0].start.line=3700;complete();complete();
    expect(state.posts.filter(item=>item.message.type==='reveal').map(item=>item.message.offset)).toEqual([370000]);
    (document as any).version=4;state.viewChanges.get(uri)!();state.posts=[];
    complete(3);expect(state.posts.filter(item=>item.message.type==='reveal')).toEqual([]);
    state.editors[0].visibleRanges[0].start.line=3900;complete(4);
    expect(state.posts.filter(item=>item.message.type==='reveal').map(item=>item.message.offset)).toEqual([390000]);
  });
  it('does not take control from a reader gesture',()=>{
    const {uri,complete}=prepare();
    state.receivers.get(uri)!({type:'scrollIntent',active:true,epoch:1,generation:0});complete();
    expect(state.posts.filter(item=>item.message.type==='reveal')).toEqual([]);
  });
  it('keeps a preview independent when synchronization is disabled',()=>{
    const {complete}=prepare();
    state.syncScroll=false;
    complete();
    expect(state.posts.filter(item=>item.message.type==='reveal')).toEqual([]);
  });
});


describe('host loading deadlines across hidden source revisions',()=>{
  const progress=(document:VSCode.TextDocument,status:'loading'|'ready')=>state.receivers.get(document.uri.toString())!({type:'loadProgress',progress:{uri:document.uri.toString(),version:3,requestId:'old-job',status,phase:status==='ready'?'ready':'parse',percent:status==='ready'?100:20}});
  it('reclaims a timed-out hidden guest even after the unsent native buffer advances',()=>{
    vi.useFakeTimers();const document=attach('workspace/loading.md'),key=document.uri.toString(),panel=state.panels.get(key);
    state.viewChanges.get(key)!();progress(document,'loading');
    const html=panel.webview.html;panel.visible=false;(document as {version:number}).version=4;
    vi.advanceTimersByTime(60_000);expect(panel.webview.html).not.toBe(html);
    panel.visible=true;state.viewChanges.get(key)!();
    const message=state.posts.filter(item=>item.message.type==='state').at(-1).message;
    expect(message.state.document.version).toBe(4);expect(message.state.loadError).toBeUndefined();
  });
  it('accepts completion of the last sent revision without timing out a newer hidden edit',()=>{
    vi.useFakeTimers();const document=attach('workspace/loading.md'),key=document.uri.toString(),panel=state.panels.get(key);
    state.viewChanges.get(key)!();progress(document,'loading');
    const html=panel.webview.html;panel.visible=false;(document as {version:number}).version=4;
    progress(document,'ready');vi.advanceTimersByTime(60_000);
    expect(panel.webview.html).toBe(html);
  });
  it('starts a restored hidden reader deadline only when it is first shown',()=>{
    vi.useFakeTimers();const document=attach('workspace/loading.md',false),key=document.uri.toString(),panel=state.panels.get(key);
    const html=panel.webview.html;vi.advanceTimersByTime(60_000);expect(panel.webview.html).toBe(html);
    panel.visible=true;state.viewChanges.get(key)!();vi.advanceTimersByTime(60_000);expect(panel.webview.html).not.toBe(html);
  });
});
