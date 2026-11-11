import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reportSenses: vi.fn(),
  sensesOptedIn: vi.fn(),
}));

vi.mock("@/lib/animaSenses", () => ({
  SENSES_REPORT_INTERVAL_MS: 30 * 60_000,
  reportSenses: mocks.reportSenses,
  sensesOptedIn: mocks.sensesOptedIn,
}));

import { useSensesReporter } from "./useSensesReporter";

function Probe({ enabled }) {
  useSensesReporter(enabled);
  return null;
}

describe("useSensesReporter", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reportSenses.mockResolvedValue(null);
  });

  it("does not report until opted in", () => {
    mocks.sensesOptedIn.mockReturnValue(false);
    render(<Probe enabled />);
    expect(mocks.reportSenses).not.toHaveBeenCalled();
  });

  it("reports once on sign-in when opted in", () => {
    mocks.sensesOptedIn.mockReturnValue(true);
    render(<Probe enabled />);
    expect(mocks.reportSenses).toHaveBeenCalledOnce();
  });

  it("does nothing when the session is not authenticated", () => {
    mocks.sensesOptedIn.mockReturnValue(true);
    render(<Probe enabled={false} />);
    expect(mocks.reportSenses).not.toHaveBeenCalled();
  });
});
