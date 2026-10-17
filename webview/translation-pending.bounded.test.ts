import { describe, expect, it } from 'vitest';
import { createDocument, standard, type DocumentSnapshot, type MarkdownNode } from '@linloir/limr';
import type { ReaderSettings } from '../src/shared/protocol';
import { PendingTranslationPreferences } from './translation-pending';
const block='<translations>\n<origin>Original paragraph.</origin>\n<translation>译文段落。</translation>\n</translations>';
const parse=(source:string,streaming=false)=>createDocument(source,{id:'file:///bounded-pending.md',extensions:standard(),streaming}).getSnapshot();
function nodes(snapshot:DocumentSnapshot){const out:MarkdownNode[]=[];const visit=(node:MarkdownNode)=>{if(node.name==='translations')out.push(node);node.children?.forEach(visit);};snapshot.blocks.forEach(block=>visit(block.node));return out;}
function setup(){const source=block+'\n\n'+block.replace('Original paragraph.','Never clicked paragraph.')+'\n\nFinal plain paragraph.',prefix=parse(block+'\n\n',true),complete=parse(source);const controller=new PendingTranslationPreferences();controller.configure({uri:complete.id,version:1,source},{translationMode:'bilingual',fileOverrides:{}} as ReaderSettings);controller.observe(prefix,false);controller.change(nodes(prefix)[0],'origin',prefix);return{source,prefix,complete,controller};}
describe('bounded host translation owner handoff',()=>{
 it('refuses duplicate source owners even if only one has the old role signature',()=>{
  const{complete,controller}=setup(),node=nodes(complete)[0],duplicate=structuredClone(node);
  const role=(duplicate.children??[]).flatMap(child=>child.type==='paragraph'?child.children??[]:[child]).find(child=>child.name==='translation');expect(role?.position).toBeDefined();role!.position!.start.offset++;
  const root=complete.blocks[0].node;const children=root===node?[node,duplicate]:[...(root.children??[]),duplicate];
  complete.blocks[0].node={type:'root',position:structuredClone(root.position),children};
  expect(controller.mode(node,complete)).toBe('both');
  expect(controller.observe(complete,true)).toBeUndefined();
 });
 it('visits unrelated full blocks only for the still-required complete persistent key universe',()=>{
  const{complete,controller}=setup(),last=complete.blocks.at(-1)!.node,children=last.children;let reads=0;
  Object.defineProperty(last,'children',{configurable:true,get(){reads++;return children;}});
  const update=controller.observe(complete,true);expect(update?.settings.translationMode).toBe('paragraph');
  expect(Object.values(update!.settings.translationParagraphs!)).toEqual(['origin','both']);expect(reads).toBe(1);
 });
 it('does not repeat source equality or AST traversal for a previously validated identical complete receipt',()=>{
  const{source,complete,controller}=setup();let reads=0;Object.defineProperty(complete,'source',{configurable:true,get(){reads++;return source;}});
  expect(controller.observe(complete,true)).toBeDefined();expect(reads).toBeGreaterThan(0);const before=reads;
  expect(controller.observe(complete,true)).toBeUndefined();expect(controller.observe(complete,true)).toBeUndefined();expect(reads).toBe(before);
 });
 it.each(['duplicate','reverse','overlap'])('refuses %s top-level ranges rather than assuming binary source lookup is valid',(shape)=>{
  const{complete,controller}=setup(),blocks=complete.blocks as (typeof complete.blocks)[number][],first=blocks[0];
  if(shape==='duplicate'){const duplicate=structuredClone(first.node);const all:MarkdownNode[]=[];const visit=(node:MarkdownNode)=>{if(node.name==='translation')all.push(node);node.children?.forEach(visit);};visit(duplicate);expect(all[0]?.position).toBeDefined();all[0].position!.start.offset++;blocks.splice(1,0,{...first,id:'duplicate-owner',node:duplicate});}
  else if(shape==='reverse')[blocks[0],blocks[1]]=[blocks[1],blocks[0]];
  else blocks[1].range={...blocks[1].range,start:first.range.end-1};
  const order=blocks.map(block=>block.id);expect(controller.observe(complete,true)).toBeUndefined();expect(blocks.map(block=>block.id)).toEqual(order);
 });
 it('refuses a new giant owner subtree before visiting it and avoids key enumeration when no intent remains eligible',()=>{
  const{complete,controller}=setup(),node=nodes(complete)[0];let reads=0;node.children=new Array(1_000_000);Object.defineProperty(node.children,'0',{get(){reads++;throw new Error('Final giant descendant should not be visited');}});
  expect(controller.observe(complete,true)).toBeUndefined();expect(reads).toBe(0);
 });
});
