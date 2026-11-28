// SwitchBot のライトのボタンを、実物のリモコンと同じ並びにする
//   暗く      ·    明るく
//   暖色      ·    白色
//   30分切り  常夜灯  全灯
// 3 列のマス目での固定位置 [行, 列] (列は 1 始まり)
const BUTTON_SLOTS: Record<string, [number, number]> = {
  暗く: [0, 1],
  明るく: [0, 3],
  暖色: [1, 1],
  白色: [1, 3],
  '30分切り': [2, 1],
  常夜灯: [2, 2],
  全灯: [2, 3],
};
export const GRID_COLUMNS = 3;

/** 各ボタンの CSS Grid 上の位置。ボタンがない行は詰め、位置が決まっていないボタンは下の行に順に並べる */
export function placeButtons(labels: string[]): { gridRow: number; gridColumn: number }[] {
  const usedRows = [...new Set(labels.flatMap((l) => (BUTTON_SLOTS[l] ? [BUTTON_SLOTS[l][0]] : [])))].sort((a, b) => a - b);
  let extras = 0;
  return labels.map((label) => {
    const slot = BUTTON_SLOTS[label];
    if (slot) return { gridRow: usedRows.indexOf(slot[0]) + 1, gridColumn: slot[1] };
    const position = extras++;
    return {
      gridRow: usedRows.length + Math.floor(position / GRID_COLUMNS) + 1,
      gridColumn: (position % GRID_COLUMNS) + 1,
    };
  });
}

/** 一列に並べるとき (オートメーションの操作の選択など) も、リモコンと同じ順 (上の行から、左から) にする */
export function sortByRemote<T>(items: T[], label: (t: T) => string): T[] {
  const pos = placeButtons(items.map(label));
  return items
    .map((item, i) => ({ item, key: pos[i]!.gridRow * 10 + pos[i]!.gridColumn, i }))
    .sort((a, b) => a.key - b.key || a.i - b.i)
    .map((x) => x.item);
}
