// アカウントのダイアログ (views/agents/accounts-dialogs.ts) の presenter。本文を
// 記録する view に差し替え、開いたときに view に渡す値と、選び直したときの
// 描き直しを見る。本文そのものは既定の view に描かせる。

import "./_dom";
import { afterEach, describe, expect, test } from "vitest";
import {
  type AccountDialogsView,
  createAccountDialogs,
  DEFAULT_VIEW,
  type LaunchDialogProps,
  type RenameDialogProps,
} from "../views/agents/accounts-dialogs";
import { ACCOUNTS_EN } from "../views/agents/accounts-i18n";
import {
  accountsData,
  fakeAccountsClient,
  sampleAccount,
} from "./_accounts-fixture";
import { closeOpenDialog } from "./_dialog-helpers";

afterEach(() => {
  closeOpenDialog();
  document.body.replaceChildren();
});

const ACCOUNTS = [
  sampleAccount(),
  sampleAccount({ id: "claude-side", name: "side" }),
];

function setup() {
  const renames: RenameDialogProps[] = [];
  const launches: LaunchDialogProps[] = [];
  const view: AccountDialogsView = {
    ...DEFAULT_VIEW,
    rename: (props) => {
      renames.push(props);
      return DEFAULT_VIEW.rename(props);
    },
    launch: (props) => {
      launches.push(props);
      return DEFAULT_VIEW.launch(props);
    },
  };
  const dialogs = createAccountDialogs(
    {
      client: fakeAccountsClient(accountsData(ACCOUNTS)),
      getText: () => ACCOUNTS_EN,
      openPane: () => undefined,
      getOverview: () => null,
      serverRoot: () => "/home/sample/work/sample-app",
      refreshOverview: async () => undefined,
    },
    view,
  );
  return { dialogs, renames, launches };
}

const last = <T>(items: T[]): T | undefined => items[items.length - 1];

describe("the account dialogs presenter", () => {
  test("rename gives the view the current name", () => {
    const { dialogs, renames } = setup();
    void dialogs.rename(ACCOUNTS[0] ?? sampleAccount());
    expect([renames[0]?.label, renames[0]?.value]).toEqual([
      ACCOUNTS_EN.renameLabel,
      "work",
    ]);
  });

  test("launch lists the accounts of the kind and redraws when one is picked", () => {
    const { dialogs, launches } = setup();
    void dialogs.launch();
    const first = last(launches);
    expect(
      first?.accounts.items.map((item) => [item.name, item.checked]),
    ).toEqual([
      ["work", true],
      ["side", false],
    ]);
    first?.accounts.onPick("claude-side");
    expect(
      last(launches)?.accounts.items.map((item) => [item.name, item.checked]),
    ).toEqual([
      ["work", false],
      ["side", true],
    ]);
  });
});
