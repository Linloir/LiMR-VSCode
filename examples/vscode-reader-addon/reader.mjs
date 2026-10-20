// This browser module uses the reader's React and LiMR; bundle neither dependency.
export default function ({ React, limr }) {
  const block = limr.defineBlock({
    name: 'example-research-card',
    component: function ResearchCard({ children }) {
      return React.createElement('aside', { className: 'limr-example-research-card' }, children);
    },
  });
  return {
    ...block,
    annotationTypes: [{
      type: 'research-footnote',
      label: 'Research footnote',
      content: ({ data }) => React.createElement(limr.AnnotationMarkdown, { source: data.body ?? '' }),
    }],
    actions: [{
      id: 'limrExample.addFootnote',
      label: 'Add research footnote',
      icon: React.createElement(limr.ToolIcon, { name: 'footnote' }),
      visible: context => context.canEditSource(),
      run(context) {
        if (!context.canEditSource()) return;
        context.addAnnotation({
          id: `research-${crypto.randomUUID()}`,
          type: 'research-footnote',
          data: { body: 'Research footnote. Edit this text in the Markdown source.' },
          anchors: context.selection.syntax.ranges.map(range => ({
            range, documentId: context.document.id,
            quote: context.document.source.slice(range.start, range.end),
          })),
        }, { target: 'source' });
        context.clearSelection();
      },
    }],
  };
}
