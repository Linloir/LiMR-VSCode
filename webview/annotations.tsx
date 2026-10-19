import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AnnotationCard, AnnotationEditor, AnnotationMarkdown, ToolIcon, useAnnotationState,
  useAnnotations, useLiMR, useLocale, registerWorkerExtension, type Annotation, type AnnotationContentProps,
  type AnnotationOverlayCardProps, type AnnotationSidebarPreviewProps, type RendererExtension,
} from '@linloir/limr';
import { useDraft, useEditorSession } from './editor-context';
import { readingAnnotationsSyntax, readerSyntaxIds } from '../src/shared/reader-syntax';

type NoteData = { body?: string; agent?: string; threadId?: string; turnId?: string; [key: string]: unknown };
const noteKinds = [
  { type: 'margin-note', label: '旁注', english: 'Margin note', icon: 'comment', color: '#81B29A' },
  { type: 'question', label: '提问', english: 'Question', icon: 'question', color: '#E5A06E' },
  { type: 'inline-note', label: '内联笔记', english: 'Inline note', icon: 'note', color: '#6B9BD2' },
  { type: 'footnote', label: '脚注', english: 'Footnote', icon: 'footnote', color: '#B39DDB' },
] as const;
const labelFor = (type: string, zh: boolean) => {
  const kind = noteKinds.find(kind => kind.type === type);
  return (zh ? kind?.label : kind?.english) ?? (zh ? '标注' : 'Annotation');
};
const bodyOf = (data?: NoteData) => data?.body ?? '';
const useChinese = () => useLocale().language?.startsWith('zh') ?? false;

function NoteActions({ annotation }: { annotation: Annotation<NoteData> }) {
  const commands = useLiMR(), zh = useChinese();
  const session = useEditorSession();
  const editable = session.editingEnabled && !!annotation.source && commands.canEditAnnotation(annotation.id);
  if (!editable) return null;
  return <div className="limr-annotation-actions lv-note-actions" data-limr-card-interactive="true">
    <button type="button" disabled={session.busy} aria-label={zh ? `编辑${labelFor(annotation.type, zh)}` : `Edit ${labelFor(annotation.type, zh).toLowerCase()}`} onClick={event => {
      event.stopPropagation(); commands.editAnnotation(annotation.id);
    }}><ToolIcon name="edit" /><span className="limr-underline">{zh ? '编辑' : 'Edit'}</span></button>
    <button type="button" disabled={session.busy} className="lv-delete" aria-label={zh ? `删除${labelFor(annotation.type, zh)}` : `Delete ${labelFor(annotation.type, zh).toLowerCase()}`} onClick={event => {
      event.stopPropagation();
      try {
        commands.removeAnnotation(annotation.id);
        if (commands.document.getSnapshot().annotations.some(item => item.id === annotation.id)) throw new Error(zh ? '删除未被接受，请重试。' : 'Deletion was not accepted; please try again.');
        void session.waitForCommit().catch(error => session.notify(error instanceof Error ? error.message : String(error), true));
      }
      catch (error) { session.notify(error instanceof Error ? error.message : String(error), true); }
    }}><ToolIcon name="trash" /><span className="limr-underline">{zh ? '删除' : 'Delete'}</span></button>
  </div>;
}

function NoteContent({ annotation, data, editing, presentation }: AnnotationContentProps<NoteData>) {
  const commands = useLiMR(), zh = useChinese();
  const session = useEditorSession();
  const { active } = useAnnotationState();
  const { occurrences } = useAnnotations();
  const activeHere = occurrences.some(item => item.id === active && item.annotationIds.includes(annotation.id));
  const body = bodyOf(data), draft = useDraft(annotation.id, body);
  const canEdit = session.editingEnabled && !!annotation.source && commands.canEditAnnotation(annotation.id);
  const conflict = body !== draft.base && body !== draft.value && !draft.saving;
  const content = useRef<HTMLDivElement>(null);
  const [focusReady, setFocusReady] = useState(false);
  const requestFocus = !!editing && !session.busy && (presentation !== 'preview' || activeHere);
  useLayoutEffect(() => {
    setFocusReady(false);
    const element = content.current;
    if (!requestFocus || !element) return;
    // A measured sidebar cluster can still have hidden descendants for a
    // frame. Let core autofocus only after the actual editor is visible.
    let frame = 0, attempts = 0;
    const stop = () => { cancelAnimationFrame(frame); mutations.disconnect(); resize.disconnect(); };
    const check = () => {
      frame = 0;
      // Visibility inheritance can settle after the final layout mutation.
      const field = element.querySelector('textarea');
      if (field?.getClientRects().length && getComputedStyle(field).visibility === 'visible' && !field.closest('[inert]') && !field.matches(':disabled')) {
        stop(); setFocusReady(true);
      } else if (++attempts < 30) frame = requestAnimationFrame(check);
    };
    const schedule = () => { attempts = 0; if (!frame) frame = requestAnimationFrame(check); };
    const mutations = new MutationObserver(schedule), resize = new ResizeObserver(schedule);
    mutations.observe(element.closest('.limr-sidebar-cluster,.limr-overlay-positioner') ?? element,
      { attributes: true, subtree: true, attributeFilter: ['style', 'inert', 'data-ready', 'data-open'] });
    resize.observe(element);
    schedule();
    return stop;
  }, [requestFocus, annotation.id, presentation]);
  useEffect(() => {
    const current = session.drafts.get(annotation.id, body);
    if (!current.saving && body !== current.base && (current.value === current.base || current.value === body)) {
      session.drafts.set(annotation.id, { base: body, value: body });
    }
  }, [body, annotation.id, session.drafts]);
  const save = async () => {
    const current = session.drafts.get(annotation.id, body);
    if (current.saving || session.busy) return;
    const latest = commands.document.getSnapshot().annotations.find(item => item.id === annotation.id) as Annotation<NoteData> | undefined;
    if (!latest) return;
    const latestBody = bodyOf(latest.data);
    try {
      if (!canEdit) throw new Error(zh ? '编辑已关闭，草稿仍然保留。' : 'Editing is disabled; your draft is retained.');
      if (!current.base.trim() && !current.value.trim() && !latestBody.trim()) { await cancel(); return; }
      if (latestBody !== current.base && latestBody !== current.value) throw new Error(zh ? '原文已在其他位置更新。请先载入当前内容，再合并你的草稿。' : 'The source changed elsewhere. Load its current content before merging your draft.');
      if (latestBody !== current.value) {
        const revision = commands.document.getSnapshot().revision;
        session.drafts.set(annotation.id, { ...current, saving: true, error: undefined });
        commands.updateAnnotation(annotation.id, { data: { ...latest.data, body: current.value } });
        if (commands.document.getSnapshot().revision === revision) throw new Error(zh ? '修改未被接受，请稍后重试。草稿已保留。' : 'The change was not accepted. Your draft is retained; please try again.');
        await session.waitForCommit();
      }
      const saved = commands.document.getSnapshot().annotations.find(item => item.id === annotation.id) as Annotation<NoteData> | undefined;
      const savedBody = saved ? bodyOf(saved.data) : current.value;
      session.drafts.set(annotation.id, { base: savedBody, value: savedBody });
      commands.commitAnnotationEdit(annotation.id);
    } catch (error) {
      session.drafts.set(annotation.id, { ...current, saving: false, error: error instanceof Error ? error.message : String(error) });
      commands.editAnnotation(annotation.id);
    }
  };
  const cancel = async () => {
    const discarded = session.drafts.get(annotation.id, body);
    if (session.busy || discarded.saving) return;
    const latest = commands.document.getSnapshot().annotations.find(item => item.id === annotation.id) as Annotation<NoteData> | undefined;
    const savedBody = bodyOf(latest?.data);
    // Reset before leaving edit mode so exit/blur cannot save the discarded draft.
    session.drafts.set(annotation.id, { base: savedBody, value: savedBody, saving: true });
    try {
      if (!commands.cancelAnnotationEdit(annotation.id)) throw new Error(zh ? '取消未被接受，草稿已保留。' : 'Cancellation was not accepted; your draft is retained.');
      await session.waitForCommit();
      session.drafts.set(annotation.id, { base: savedBody, value: savedBody });
    } catch (error) {
      session.drafts.set(annotation.id, { ...discarded, saving: false, error: error instanceof Error ? error.message : String(error) });
      commands.editAnnotation(annotation.id);
    }
  };
  // The shared draft survives overlay/sidebar changes and is saved on edit exit.
  const saveRef = useRef(save); saveRef.current = save;
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current && !editing) void saveRef.current();
    wasEditing.current = editing;
  }, [editing, annotation.id, body, session.drafts]);
  return <div ref={content} className="lv-note-content" data-limr-card-interactive="true" data-annotation-id={annotation.id}>
    {editing && canEdit ? <fieldset className="lv-editor-fieldset" disabled={session.busy || draft.saving}>
      <AnnotationEditor value={draft.value} label={zh ? `${labelFor(annotation.type, zh)}内容` : `${labelFor(annotation.type, zh)} content`} placeholder={annotation.type === 'question' ? (zh ? '写下你想进一步理解的问题…' : 'What would you like to understand?') : (zh ? '记录你的想法，可以使用 Markdown…' : 'Write your thoughts using Markdown…')}
        autoFocus={focusReady && requestFocus}
        onChange={value => session.drafts.set(annotation.id, { ...session.drafts.get(annotation.id, body), value, error: undefined })}
        onSubmit={() => void save()} onCancel={() => void cancel()} onBlur={() => void save()} submitLabel={zh ? '保存' : 'Save'} cancelLabel={zh ? '取消' : 'Cancel'} />
    </fieldset> : <>
      {body ? <AnnotationMarkdown source={body} /> : <p className="lv-note-empty">{canEdit ? (zh ? '点击编辑，写下你的想法。' : 'Choose Edit to write a note.') : (zh ? '暂无内容。' : 'No content yet.')}</p>}
      {(data?.agent || data?.threadId) && <div className="lv-agent-meta"><span>{data.agent || (zh ? 'AI 对话' : 'AI conversation')}</span>{data.threadId && <code title={String(data.threadId)}>{String(data.threadId)}</code>}</div>}
      <NoteActions annotation={annotation} />
    </>}
    {(conflict || draft.error) && <div className="lv-note-error" role="alert"><p>{draft.error || (zh ? '原文已更新，当前草稿仍然保留。' : 'The source changed; your draft is retained.')}</p>
      {conflict && <button type="button" onClick={() => session.drafts.set(annotation.id, { base: body, value: body })}><span className="limr-underline">{zh ? '载入当前内容' : 'Load current content'}</span></button>}
    </div>}
  </div>;
}

function NotePreview({ annotation, data }: AnnotationSidebarPreviewProps<NoteData>) {
  const zh = useChinese();
  const text = bodyOf(data).replace(/\s+/g, ' ').trim();
  return <div className="lv-note-preview">
    <span className="lv-note-summary">{text || (zh ? '暂无内容' : 'No content yet')}</span>
    <NoteActions annotation={annotation} />
  </div>;
}
function NoteCard(props: AnnotationOverlayCardProps<NoteData>) {
  return <AnnotationCard {...props} title={labelFor(props.annotation.type, useChinese())} />;
}

/** Applications own note presentation; LiMR owns parsing, geometry and source serialization. */
export function readingAnnotations(language: 'zh-CN' | 'en' = 'zh-CN'): RendererExtension {
  const extension: RendererExtension = { ...readingAnnotationsSyntax(), annotationTypes: noteKinds.map(kind => ({
    type: kind.type, label: language === 'zh-CN' ? kind.label : kind.english, icon: <ToolIcon name={kind.icon} />, color: kind.color,
    Content: NoteContent,
    sidebar: { Preview: NotePreview, previewLines: 3, collapseOnContentClick: false },
    overlay: { Card: NoteCard, previewWidth: 320, expand: { placement: 'anchor', width: 440, maxHeight: '75dvh' } },
  })) };
  return registerWorkerExtension(extension, { id: readerSyntaxIds.annotations });
}
