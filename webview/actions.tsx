import { deleteAnnotations, highlightPalette, highlightSelection, ToolIcon, type ActionContext, type SelectionAction } from '@linloir/limr';
import { reusableRangeIds } from '../src/shared/ai-context';
import { translationPeers } from '../src/shared/question-context';
import { shortAnnotationId } from '../src/shared/annotation-ids';
import type { ReaderDocument } from '../src/shared/protocol';
import { copyClipboard, prepareQuestionContext } from './bridge';

interface ActionOptions {
  getDocument(): ReaderDocument;
  getLanguage(): 'zh-CN' | 'en';
  canWrite(): boolean;
  isBusy(): boolean;
  notify(message: string, error?: boolean): void;
}
export function readerActions(options: ActionOptions): SelectionAction[] {
  const zh = options.getLanguage() === 'zh-CN';
  const writable = (context: ActionContext) => options.canWrite() && context.canEditSource();
  const palette = highlightPalette(), highlight = highlightSelection(), remove = deleteAnnotations();
  const addNote = (type: 'margin-note' | 'question'): SelectionAction => ({
    id: `lv-${type}`, label: type === 'margin-note' ? (zh ? '添加旁注' : 'Add margin note') : (zh ? '添加提问' : 'Add question'),
    icon: <ToolIcon name={type === 'margin-note' ? 'comment' : 'question'} />,
    visible: writable, disabled: () => options.isBusy(),
    run: context => {
      if (!writable(context) || options.isBusy()) return;
      context.addAnnotation({ id: shortAnnotationId(context.document), type, data: { body: '' },
        anchors: context.selection.syntax.ranges.map(range => ({ range, documentId: context.document.id, quote: context.document.source.slice(range.start, range.end) })),
      }, { target: 'source', edit: true });
      context.clearSelection();
    },
  });
  return [
    { ...palette, visible: context => writable(context) && (palette.visible?.(context) ?? true), disabled: () => options.isBusy(),
      render: context => palette.render!({ ...context, busy: context.busy || options.isBusy() }),
      renderExpanded: context => <fieldset className="lv-editor-fieldset" disabled={options.isBusy()}>{palette.renderExpanded!(context)}</fieldset>,
    },
    { ...highlight, visible: context => writable(context) && (highlight.visible?.(context) ?? true), disabled: () => options.isBusy(), run: context => {
      if (writable(context) && !options.isBusy()) return highlight.run!(context);
    } },
    addNote('margin-note'), addNote('question'),
    { id: 'lv-copy', readOnly: true, label: zh ? '复制' : 'Copy', icon: <ToolIcon name="copy" />, successLabel: zh ? '已复制' : 'Copied', successIcon: <ToolIcon name="check" />,
      run: async context => { await copyClipboard(context.selection.text); },
    },
    { id: 'lv-question-context', label: zh ? '提问上下文' : 'Question context', icon: <ToolIcon name="sparkles" />,
      successLabel: zh ? '已复制上下文' : 'Context copied', successIcon: <ToolIcon name="check" />,
      disabled: context => options.isBusy() || context.document.source !== options.getDocument().source,
      renderExpanded: () => <div className="lv-context-hint"><strong>{zh ? '复制后，粘贴给 AI 助手提问' : 'Copy, then paste your question into your AI assistant'}</strong><p>{zh ? '包含文件引用、选区和快速回写入口。AI 先回答，再将问题和答案写入文档。' : 'Includes the file, selection and quick writeback entry. The assistant answers first, then records the question and answer.'}</p></div>,
      run: async context => {
        const document = options.getDocument();
        if (options.isBusy() || context.document.source !== document.source) return;
        // A reused range name can refer to several occurrences. Expose it only
        // when every occurrence is selected, so writing a question cannot expand it.
        const rangeIds = reusableRangeIds(context.document.annotationRanges, context.selection.syntax.ranges);
        const payload = await prepareQuestionContext(document.version, { ranges: context.selection.syntax.ranges,
          selectedText: context.selection.text, rangeIds, annotationIds: context.annotations.map(annotation => annotation.id),
          peers: translationPeers(context.document, context.selection.syntax.ranges),
        });
        const result = await copyClipboard(payload.text, payload.html);
        options.notify(result === 'rich'
          ? (zh ? '已复制文件引用和提问上下文，粘贴给 AI 助手即可。' : 'File reference and question context copied. Paste them into your AI assistant.')
          : (zh ? '已复制包含文件路径和选区的文本上下文，粘贴给 AI 助手即可。' : 'Text context with file path and selection copied. Paste it into your AI assistant.'));
      },
    },
    { ...remove, visible: context => writable(context) && (remove.visible?.(context) ?? false), disabled: () => options.isBusy(),
      run: context => {
        if (writable(context) && !options.isBusy()) return remove.run!(context);
      },
    },
  ];
}
