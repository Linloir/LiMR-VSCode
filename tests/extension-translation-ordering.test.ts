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
  return {Uri,dispose,event,provider:undefined as unknown,documents:[] as any[],picks:[] as string[],posts:[] as any[],updates:[] as any[],folderValues:new Map<string,unknown>(),workspaceValue:undefined as unknown,globalValue:'bilingual' as unknown,configBarrier:undefined as undefined|(()=>void),context:undefined as any};
});
vi.mock('vscode',()=>({
  Uri:state.Uri,StatusBarAlignment:{Right:2},ConfigurationTarget:{Global:1,Workspace:2,WorkspaceFolder:3},
  TabInputCustom:class{},ColorThemeKind:{Light:1,HighContrast:3,HighContrastLight:4},
  env:{language:'en'},
  commands:{registerCommand:()=>state.dispose(),executeCommand:async()=>undefined},
  window:{
    registerCustomEditorProvider:(_name:string,provider:unknown)=>{state.provider=provider;return state.dispose();},
    createStatusBarItem:()=>({show(){},hide(){},dispose(){}}),
    showQuickPick:async(items:{value:string}[])=>{const value=state.picks.shift();const item=items.find(item=>item.value===value);if(!item)throw new Error('Unexpected native picker '+value);return item;},
    showErrorMessage:async(message:string)=>{throw new Error(message);},showInformationMessage:async()=>undefined,
    visibleTextEditors:[],activeTextEditor:undefined,activeColorTheme:{kind:1},
    onDidChangeActiveColorTheme:state.event,onDidChangeActiveTextEditor:state.event,onDidChangeTextEditorSelection:state.event,onDidChangeWindowState:state.event,onDidChangeTextEditorVisibleRanges:state.event,
    tabGroups:{activeTabGroup:{activeTab:undefined},onDidChangeTabs:state.event},
  },
  workspace:{
    get textDocuments(){return state.documents;},isTrusted:true,fs:{isWritableFileSystem:()=>true},
    getWorkspaceFolder:(uri:InstanceType<typeof state.Uri>)=>({uri:state.Uri.parse('file:///'+uri.path.split('/')[1])}),
    getConfiguration:(_section:string,uri?:InstanceType<typeof state.Uri>)=>{
      const folder=uri?.path.split('/')[1],folderValue=folder&&state.folderValues.get(folder);
      return {get:(key:string,fallback:unknown)=>key==='translationMode'?(folderValue??state.workspaceValue??state.globalValue):fallback,
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
function attach(path:string){
  const uri=state.Uri.parse('file:///'+path) as unknown as VSCode.Uri;
  const document={uri,version:3,isDirty:false,languageId:'markdown',getText:()=> 'Unmodified source.'} as VSCode.TextDocument;
  state.documents.push(document);
  const webview={options:{},html:'',cspSource:'https://test.invalid',asWebviewUri:(value:unknown)=>value,onDidReceiveMessage:state.event,postMessage:async(message:unknown)=>{state.posts.push({uri:uri.toString(),message});return true;}};
  const panel={active:true,visible:true,webview,onDidChangeViewState:state.event,onDidDispose:state.event} as unknown as VSCode.WebviewPanel;
  provider.resolveCustomTextEditor(document,panel);return document;
}
beforeEach(()=>{
  state.documents=[];state.picks=[];state.posts=[];state.updates=[];state.folderValues.clear();state.workspaceValue=undefined;state.globalValue='bilingual';state.configBarrier=undefined;
  values=new Map();writes=[];blockNext=undefined;
  const context={subscriptions:[],extensionUri:state.Uri.parse('file:///extension'),asAbsolutePath:(path:string)=>'/extension/'+path,
    workspaceState:{get:(key:string,fallback:ReaderFileSettings)=>values.get(key)??fallback,update:async(key:string,value:ReaderFileSettings|undefined)=>{const held=blockNext;blockNext=undefined;if(held){held.entered.resolve();await held.released.promise;}writes.push({key,value:structuredClone(value)});if(value)values.set(key,structuredClone(value));else values.delete(key);}},};
  state.context=context;activate(context as unknown as VSCode.ExtensionContext);provider=state.provider as Provider;
});
afterEach(()=>{provider?.dispose();state.context?.subscriptions.forEach((item:{dispose():void})=>item.dispose());});

describe('native provisional translation write ordering (actual registered provider)',()=>{
  it('rejects a queued old completion after a same-value native default choice, before config write',async()=>{
    const document=attach('workspace/a.md'),held={entered:deferred(),released:deferred()};blockNext=held;
    const earlier=provider.setFileSettings(document.uri,{typography:'justify'});await held.entered.promise;
    const stale=provider.setFileSettings(document.uri,{translationMode:'paragraph',translationParagraphs:{old:'origin'}},false,0,3);
    state.picks=['default','bilingual'];state.configBarrier=()=>{expect(state.posts.some(item=>item.uri===document.uri.toString()&&item.message.type==='translationIntent'&&item.message.epoch===1)).toBe(true);};
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
    state.picks=['default','bilingual'];
    state.configBarrier=()=>{const notified=state.posts.filter(item=>item.message.type==='translationIntent').map(item=>item.uri).sort();expect(notified).toEqual([first.uri.toString(),second.uri.toString()].sort());};
    await provider.choosePreference('translationMode',first.uri);
    expect(state.updates).toEqual([{key:'translationMode',value:'bilingual',target:2}]);
    expect(state.posts.filter(item=>item.message.type==='translationIntent').every(item=>![folder.uri.toString(),file.uri.toString()].includes(item.uri))).toBe(true);
  });
});
