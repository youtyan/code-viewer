// SSE の本文を、届いた断片の順に知らせへ分ける (HTML の EventSource の読み方)。
// 生きた知らせ (live/handle.ts) が、裏のプロセスの /events を読んで 1 本の流しへ
// 載せ替えるのに使う。
//
// - 行の終わりは \n・\r\n・\r のどれでもよい。断片の境目で切れた行は次の断片と継ぐ
// - `:` で始まる行は注釈 (ping・ok) で、知らせにしない
// - data の行が複数あれば \n で継ぐ。空行で 1 つの知らせを出す (data が無ければ出さない)
// - event が無ければ "message"。id・retry は使わないので読み捨てる

export type SseParser = {
  push(text: string): void;
};

export function createSseParser(
  onEvent: (event: string, data: string) => void,
): SseParser {
  let pending = "";
  let event = "";
  let data: string[] = [];
  // \r で終わった断片の次の \n は、同じ行の終わりの続き。
  let skipNewline = false;

  function line(text: string): void {
    if (text === "") {
      if (data.length > 0) onEvent(event || "message", data.join("\n"));
      event = "";
      data = [];
      return;
    }
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon < 0 ? text : text.slice(0, colon);
    let value = colon < 0 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }

  return {
    push(text) {
      let rest = text;
      if (skipNewline && rest.startsWith("\n")) rest = rest.slice(1);
      skipNewline = false;
      pending += rest;
      for (;;) {
        const end = pending.search(/[\r\n]/);
        if (end < 0) return;
        line(pending.slice(0, end));
        if (pending[end] === "\r") {
          if (end + 1 === pending.length) {
            skipNewline = true;
            pending = "";
            return;
          }
          pending = pending.slice(
            pending[end + 1] === "\n" ? end + 2 : end + 1,
          );
        } else {
          pending = pending.slice(end + 1);
        }
      }
    },
  };
}
