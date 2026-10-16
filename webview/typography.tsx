import { mapText, type MarkdownNode, type NodeRendererProps, type RendererExtension, type SourcePoint } from '@linloir/limr';

type Script = 'latin' | 'chinese' | 'other';
function scriptFor(character: string, previous: Script): Script {
  if (/\p{Script=Han}/u.test(character)) return 'chinese';
  if (/[\p{Script=Latin}\p{Number}]/u.test(character)) return 'latin';
  if (/[\p{Letter}\p{Symbol}]/u.test(character)) return 'other';
  return previous;
}
function point(source: string, offset: number, origin: SourcePoint): SourcePoint {
  const preceding = source.slice(0, offset), lines = preceding.split(/\r\n|\r|\n/);
  return { offset: origin.offset + offset, line: origin.line + lines.length - 1, column: lines.length > 1 ? lines.at(-1)!.length + 1 : origin.column + preceding.length };
}
function ScriptText({ node, children }: NodeRendererProps) {
  return <span className={`lv-script-${node.lvScript}`}>{children}</span>;
}

/** Split before LiMR associates source markers with text-node identities.
 * Native text renderers retain annotation markers, selection bindings and paint. */
export function languageTypography(): RendererExtension {
  return {
    name: 'vscode-language-typography', scope: 'local',
    rendererOverrides: [{ type: 'lv-script', component: ScriptText }],
    transform(root, { source }) {
      const visit = (node: MarkdownNode) => {
        if (!node.children || node.type === 'lv-script') return;
        node.children = node.children.flatMap(child => {
          if (child.type !== 'text' || !child.position || !child.value) { visit(child); return [child]; }
          const start = child.position.start.offset, end = child.position.end.offset;
          const raw = source.slice(start, end), value = child.value;
          const mapping = mapText(source, value, { start, end }, { escapes: child.verbatimEscapes !== true, omissions: child.sourceOmissions });
          if (!mapping.exact) return [child];
          const pieces: { start: number; end: number; script: Script }[] = [];
          let offset = 0, previous: Script = 'latin';
          for (const character of value) {
            const script = scriptFor(character, previous), last = pieces.at(-1);
            if (last?.script === script) last.end += character.length;
            else pieces.push({ start: offset, end: offset + character.length, script });
            offset += character.length; previous = script;
          }
          return pieces.map(piece => {
            const position = {
              start: point(raw, mapping.starts[piece.start] - start, child.position!.start),
              end: point(raw, mapping.ends[piece.end - 1] - start, child.position!.start),
            };
            const leaf: MarkdownNode = { ...child, value: value.slice(piece.start, piece.end), position };
            return { type: 'lv-script', lvScript: piece.script, position, children: [leaf] } as MarkdownNode;
          });
        });
      };
      visit(root);
    },
  };
}
