// 古い Safari (iOS 12〜14.0) でも見た目が崩れないように、ビルド時に CSS の代わりの書き方を足す PostCSS プラグイン。
// wakalabo の各アプリで同じものを使う (wakalabo-apps/web/legacy-css.ts からコピーする)。
//
// 1. flex の gap (Safari 14.1 から): 子要素の margin で間隔を作る。
//    gap に対応していないブラウザだけに効かせるため @supports not (translate: 0) で囲む
//    (translate プロパティは flex の gap と同じ Safari 14.1 から使える)
// 2. dvh (Safari 15.4 から): 直前に vh の指定を足す
// 3. color-mix() (Safari 16.2 から): 直前に 1 つ目の色だけの指定を足す
// 4. clamp() (Safari 13.1 から): 直前に max(最小, min(推奨, 最大)) の指定を足す (Safari 11.1 から使える)
//
// 新しいブラウザは後に書かれた元の指定を使うので、見た目は変わらない。
import type { AtRule, ChildNode, Container, Declaration, Plugin, Rule } from 'postcss';

// LEGACY_CSS_TEST=1 でビルドすると、新しいブラウザでも代わりの書き方を効かせる (古い iPad の見た目を確かめる用)
const NO_FLEX_GAP = process.env.LEGACY_CSS_TEST ? 'not (wakalabo-test: 1)' : 'not (translate: 0)';

type Direction = 'row' | 'column';
interface FlexInfo {
  direction: Direction;
  wrap: boolean;
}

const decl = (rule: Rule, prop: string): string | undefined => {
  let value: string | undefined;
  rule.each((n) => {
    if (n.type === 'decl' && n.prop === prop) value = n.value;
  });
  return value;
};

const isFlex = (rule: Rule) => /^(inline-)?flex$/.test(decl(rule, 'display') ?? '');

/** 同じセレクターの別のルールに書かれた display: flex なども拾えるように、シート全体からセレクターごとの情報を集める */
function collectFlex(root: Container): Map<string, FlexInfo> {
  const map = new Map<string, FlexInfo>();
  root.walkRules((rule) => {
    if (!isFlex(rule)) return;
    for (const sel of rule.selectors) {
      map.set(sel, {
        direction: /^column/.test(decl(rule, 'flex-direction') ?? '') ? 'column' : 'row',
        wrap: /^wrap/.test(decl(rule, 'flex-wrap') ?? ''),
      });
    }
  });
  return map;
}

/** "12px" / "12px 8px" → [row-gap, column-gap] */
function parseGap(rule: Rule): [string | undefined, string | undefined] {
  const gap = decl(rule, 'gap');
  if (gap) {
    const parts = gap.trim().split(/\s+(?![^(]*\))/);
    return [parts[0], parts[1] ?? parts[0]];
  }
  return [decl(rule, 'row-gap'), decl(rule, 'column-gap')];
}

const isZero = (v?: string) => !v || /^0(px|rem|em)?$/.test(v.trim());

function flexGapFallback(rule: Rule, flex: Map<string, FlexInfo>): string | null {
  const [rowGap, colGap] = parseGap(rule);
  if (isZero(rowGap) && isZero(colGap)) return null;
  const parts: string[] = [];
  for (const sel of rule.selectors) {
    // このルール自身に display / flex-direction があればそれを、なければ同じセレクターの別のルールを見る
    const own = isFlex(rule) ? { direction: /^column/.test(decl(rule, 'flex-direction') ?? '') ? 'column' : 'row', wrap: /^wrap/.test(decl(rule, 'flex-wrap') ?? '') } : undefined;
    const info = (own as FlexInfo | undefined) ?? flex.get(sel);
    if (!info) continue; // flex ではない (grid の gap は Safari 12 から使える)
    if (info.wrap) {
      // 折り返すときは、右と下に間隔を空ける (右端・最終行にも少し余白が残るが、崩れはしない)
      const m = [isZero(rowGap) ? '0' : rowGap, isZero(colGap) ? '0' : colGap];
      parts.push(`${sel} > * { margin-right: ${m[1]}; margin-bottom: ${m[0]}; }`);
    } else if (info.direction === 'column') {
      if (!isZero(rowGap)) parts.push(`${sel} > * + * { margin-top: ${rowGap}; }`);
    } else if (!isZero(colGap)) {
      parts.push(`${sel} > * + * { margin-left: ${colGap}; }`);
    }
  }
  return parts.length ? parts.join('\n') : null;
}

const FIRST_ARG = /color-mix\(\s*in\s+[a-z-]+\s*,\s*((?:var\([^()]*\)|[^,()]+(?:\([^()]*\))?))[^)]*\)/g;

/** clamp(a, b, c) → max(a, min(b, c))。中に括弧があっても動くように、対応する括弧を数える */
function replaceClamp(value: string): string {
  let out = '';
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf('clamp(', i);
    if (at < 0) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, at);
    let depth = 0;
    let j = at + 'clamp'.length;
    const args: string[] = [];
    let start = j + 1;
    for (; j < value.length; j++) {
      const ch = value[j];
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) break;
      } else if (ch === ',' && depth === 1) {
        args.push(value.slice(start, j).trim());
        start = j + 1;
      }
    }
    args.push(value.slice(start, j).trim());
    out += args.length === 3 ? `max(${args[0]}, min(${args[1]}, ${args[2]}))` : value.slice(at, j + 1);
    i = j + 1;
  }
  return out;
}

function addValueFallback(d: Declaration) {
  let v = d.value;
  if (v.includes('dvh') || v.includes('svh') || v.includes('lvh')) v = v.replace(/(\d)(d|s|l)vh/g, '$1vh');
  if (v.includes('color-mix(')) v = v.replace(FIRST_ARG, '$1');
  if (v.includes('clamp(')) v = replaceClamp(v);
  if (v !== d.value) d.cloneBefore({ value: v });
}

export function legacyCss(): Plugin {
  return {
    postcssPlugin: 'wakalabo-legacy-css',
    Once(root, { postcss }) {
      const flex = collectFlex(root);
      root.walkDecls((d) => {
        if (!d.prop.startsWith('--')) addValueFallback(d);
      });
      root.walkRules((rule) => {
        // @supports の中に作ったものや、@keyframes の中は対象外
        const parent = rule.parent as ChildNode | undefined;
        if (parent?.type === 'atrule' && /keyframes|supports/.test((parent as AtRule).name)) return;
        const css = flexGapFallback(rule, flex);
        if (!css) return;
        // 元のルールのすぐ後ろに置く (後に書かれた子要素の margin 指定 (margin-left: auto など) が優先されるように)
        const block = postcss.atRule({ name: 'supports', params: NO_FLEX_GAP });
        block.append(postcss.parse(css));
        rule.after(block);
      });
    },
  };
}
legacyCss.postcss = true as const;
