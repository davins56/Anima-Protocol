import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PageNotFound from "./PageNotFound";

describe("PageNotFound", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders an on-brand 404 with a home link instead of a blank or light wall", () => {
    render(
      <MemoryRouter initialEntries={["/missing-floor"]}>
        <PageNotFound />
      </MemoryRouter>,
    );

    expect(screen.getByText("404")).toBeTruthy();
    expect(screen.getByText(/page not found/i)).toBeTruthy();
    expect(screen.getByText(/missing-floor/)).toBeTruthy();
    const home = screen.getByRole("link", { name: /go home/i });
    expect(home.getAttribute("href")).toBe("/");
  });
});
