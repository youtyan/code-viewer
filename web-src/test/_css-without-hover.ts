// happy-dom は :hover を常に当たるものとして扱う。実物の style.css から :hover を含む
// 選択子だけを外した CSS を返し、休んでいるときの見た目を見られるようにする
// (選択子の並びのうち :hover を含むものだけを外し、全部外れた規則は何にも当てない)。
export function withoutHover(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/([^{}]+)\{/g, (whole, head: string) => {
      if (head.trim().startsWith("@")) return whole;
      const kept = head
        .split(/,(?![^(]*\))/)
        .filter((part) => !part.includes(":hover"));
      return `${kept.length > 0 ? kept.join(",") : ":not(*)"}{`;
    });
}
