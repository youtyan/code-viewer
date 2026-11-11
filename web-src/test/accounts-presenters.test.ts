// アカウントの帯 (accounts-band.ts) と設定のアカウントの節 (accounts-settings.ts) の
// presenter。表示を記録する view に差し替え、一覧の答えから view に渡す値と、
// 押したときに呼ぶ操作 (取得・ダイアログ) を見る。

import "./_dom";
import { afterEach, describe, expect, test } from "vitest";
import {
  type AccountsBandViewProps,
  DEFAULT_VIEW as BAND_VIEW,
  createAccountsBand,
} from "../views/agents/accounts-band";
import { ACCOUNTS_EN } from "../views/agents/accounts-i18n";
import {
  type AccountsSettingsViewProps,
  createAccountsSettings,
  DEFAULT_VIEW as SETTINGS_VIEW,
} from "../views/agents/accounts-settings";
import {
  accountsData,
  fakeAccountDialogs,
  fakeAccountsClient,
  sampleAccount,
} from "./_accounts-fixture";

afterEach(() => {
  document.body.replaceChildren();
});

const last = <T>(items: T[]): T | undefined => items[items.length - 1];

const ACCOUNTS = [
  sampleAccount(),
  sampleAccount({
    id: "codex-side",
    agent: "codex",
    name: "side",
    login: { ...sampleAccount().login, state: "logged-out", who: "" },
  }),
];

describe("the accounts band presenter", () => {
  function setup() {
    const calls: string[] = [];
    const shown: AccountsBandViewProps[] = [];
    const band = createAccountsBand(
      {
        client: fakeAccountsClient(accountsData(ACCOUNTS), calls),
        dialogs: fakeAccountDialogs(calls),
        getText: () => ACCOUNTS_EN,
        hookStateLabel: (state) => state,
        getOverview: () => null,
        isCollapsed: () => false,
        setCollapsed: () => undefined,
        openSettings: () => undefined,
        requestRender: () => undefined,
        openLaunchCommands: () => undefined,
        now: () => 0,
      },
      (props) => {
        shown.push(props);
        return BAND_VIEW(props);
      },
    );
    band.render();
    return { shown, calls };
  }

  test("gives the view one card per account; a signed-out one offers sign in", () => {
    const { shown } = setup();
    const props = last(shown);
    if (props?.kind !== "band") throw new Error("the band is not shown");
    expect(
      props.cards?.map((card) => [card.name.text, card.usage.kind]),
    ).toEqual([
      ["work", "unavailable"],
      ["side", "login"],
    ]);
  });

  test("the sign-in button opens the login dialog for that account", async () => {
    const { shown, calls } = setup();
    const props = last(shown);
    if (props?.kind !== "band") throw new Error("the band is not shown");
    const usage = props.cards?.[1]?.usage;
    if (usage?.kind !== "login") throw new Error("no sign-in button");
    usage.login.onClick();
    await Promise.resolve();
    expect(calls).toEqual(["login codex-side"]);
  });
});

describe("the accounts settings presenter", () => {
  function setup() {
    const calls: string[] = [];
    const shown: AccountsSettingsViewProps[] = [];
    const section = createAccountsSettings(
      {
        client: fakeAccountsClient(accountsData(ACCOUNTS), calls),
        dialogs: fakeAccountDialogs(calls),
        getText: () => ACCOUNTS_EN,
        now: () => 0,
      },
      (props) => {
        shown.push(props);
        return SETTINGS_VIEW(props);
      },
    );
    return { section, shown, calls };
  }

  test("gives the view one row per account with its actions", () => {
    const { shown } = setup();
    expect(
      last(shown)?.table?.rows.map((row) => [
        row.display,
        row.login,
        row.actions.map((action) => action.label),
      ]),
    ).toEqual([
      [
        "work",
        "in",
        [
          ACCOUNTS_EN.recheck,
          ACCOUNTS_EN.tags,
          ACCOUNTS_EN.rename,
          ACCOUNTS_EN.remove,
        ],
      ],
      [
        "side",
        "out",
        [
          ACCOUNTS_EN.recheck,
          ACCOUNTS_EN.loginButton,
          ACCOUNTS_EN.tags,
          ACCOUNTS_EN.rename,
          ACCOUNTS_EN.remove,
        ],
      ],
    ]);
  });

  test("typing a launch command makes the draft unsaved and saving sends it", async () => {
    const { section, shown, calls } = setup();
    last(shown)
      ?.commands.items.find((item) => item.agent === "claude")
      ?.onInput("claude-wrapper");
    expect([
      last(shown)?.commands.unsaved.shown,
      section.draft.dirty(),
    ]).toEqual([true, true]);
    await section.draft.save();
    expect(calls).toEqual([
      'savePreferences {"claude":"claude-wrapper","codex":""}',
    ]);
  });
});
