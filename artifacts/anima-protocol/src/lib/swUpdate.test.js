import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetReplyActivity, beginReply, isReplyInFlight } from "./replyActivity";
import { _setUpdateSW, applyUpdate, initServiceWorker, isUpdateReady, SW_UPDATE_EVENT } from "./swUpdate";

describe("service worker update prompt", () => {
  afterEach(() => _resetReplyActivity());

  it("announces a waiting update instead of reloading", () => {
    let opts;
    const update = vi.fn();
    const heard = vi.fn();
    window.addEventListener(SW_UPDATE_EVENT, heard);
    initServiceWorker((o) => {
      opts = o;
      return update;
    });
    expect(opts.immediate).toBe(true);
    opts.onNeedRefresh();
    expect(isUpdateReady()).toBe(true);
    expect(heard).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    window.removeEventListener(SW_UPDATE_EVENT, heard);
  });

  it("reloads right away when nothing is streaming", () => {
    const update = vi.fn();
    _setUpdateSW(update);
    expect(applyUpdate()).toBe(false);
    expect(update).toHaveBeenCalledWith(true);
  });

  it("waits for an in-flight reply to finish before reloading", () => {
    const update = vi.fn();
    _setUpdateSW(update);
    const end = beginReply();
    expect(isReplyInFlight()).toBe(true);
    expect(applyUpdate()).toBe(true);
    expect(update).not.toHaveBeenCalled();
    end();
    expect(update).toHaveBeenCalledWith(true);
  });
});
