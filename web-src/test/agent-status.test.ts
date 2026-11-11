// 最下段の「入力待ち n  作業中 n」(views/agents/agent-status.ts)。数えるのは
// エージェントのペインだけで、取れていないときは 0 でなく「–」を出す。

import "./_dom";
import { afterEach, describe, expect, test } from "vitest";
import { mountAgentStatus } from "../views/agents/agent-status";
import { agentsText } from "../views/agents/i18n";
import { fakeMonitor, overview } from "./_agents-sidebar-fixture";
import { agentPane } from "./_test-helpers";

afterEach(() => {
  document.body.replaceChildren();
});

function mount(initial: Parameters<typeof fakeMonitor>[0]) {
  const button = document.createElement("button");
  button.hidden = true;
  document.body.appendChild(button);
  const feed = fakeMonitor(initial);
  mountAgentStatus(button, {
    monitor: feed.monitor,
    getText: () => agentsText("en"),
    openList: () => undefined,
    openPane: () => undefined,
  });
  const shown = () =>
    [...button.querySelectorAll(".agent-status-item")].map((item) => [
      item.querySelector(".agent-status-label")?.textContent,
      item.querySelector(".agent-status-count")?.textContent,
    ]);
  return { button, feed, shown };
}

const waiting = agentPane({ id: "%1", state: "waiting" });
const working = agentPane({ id: "%2", state: "working" });

describe("the agent counts in the status bar", () => {
  test("counts waiting and working agents and follows new lists", () => {
    const { button, feed, shown } = mount(overview([waiting], []));
    expect([shown(), button.hidden]).toEqual([
      [
        ["Needs input", "1"],
        ["Working", "0"],
      ],
      false,
    ]);

    feed.publish(overview([waiting, working], []));
    expect(shown()).toEqual([
      ["Needs input", "1"],
      ["Working", "1"],
    ]);
  });
});
