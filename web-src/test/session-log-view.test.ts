// データストアのセッションの記録 (views/database/session-log-view.ts)。描き方を
// 記録する view に差し替え、記録の並び・追従・選んだ記録の詳細・空にしたときに
// presenter が view に渡す値を見る。

import "./_dom";
import { afterEach, describe, expect, test } from "vitest";
import { createSessionLog } from "../views/database/session-log";
import {
  createSessionLogView,
  DEFAULT_VIEW,
  type SessionLogProps,
} from "../views/database/session-log-view";

const EMPTY = "No entries yet. SQL executions and commits will appear here.";

afterEach(() => {
  document.body.replaceChildren();
});

function setup() {
  const store = createSessionLog();
  const shown: SessionLogProps[] = [];
  const used: string[] = [];
  const view = createSessionLogView(
    { store, copySqlToQuery: (sql) => used.push(sql) },
    (props) => {
      shown.push(props);
      return DEFAULT_VIEW(props);
    },
  );
  document.body.append(view.el);
  const last = () => shown[shown.length - 1] as SessionLogProps;
  const add = (label: string, status: "ok" | "error" = "ok") =>
    store.add({ kind: "query", status, label, detail: `${label};` });
  return { store, view, last, add, used };
}

describe("the session log presenter", () => {
  test("lists newest first and follows the latest entry", () => {
    const { last, add } = setup();
    expect([last().empty, last().detail]).toEqual([EMPTY, null]);

    add("select 1");
    add("select 2", "error");
    expect([
      last().entries.map((e) => [e.title, e.status, e.selected]),
      last().autoFollow,
      last().detail?.sql,
    ]).toEqual([
      [
        ["select 2", "error", true],
        ["select 1", "ok", false],
      ],
      true,
      { text: "select 2;" },
    ]);
  });

  test("picking an older entry stops following and keeps it selected", () => {
    const { last, add, used } = setup();
    add("select 1");
    add("select 2");
    last().entries[1]?.onSelect();
    add("select 3");
    expect([
      last().autoFollow,
      last().entries.map((e) => e.selected),
      last().detail?.sql,
    ]).toEqual([false, [false, false, true], { text: "select 1;" }]);

    last().detail?.actions?.onUse();
    expect(used).toEqual(["select 1;"]);
  });

  test("clearing the store drops the selection", () => {
    const { last, add } = setup();
    add("select 1");
    last().onClear();
    expect([last().entries, last().detail, last().empty]).toEqual([
      [],
      null,
      EMPTY,
    ]);
  });
});
