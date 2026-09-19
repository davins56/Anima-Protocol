import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter } from "react-router-dom";
import UserNotRegisteredError from "./UserNotRegisteredError";

describe("UserNotRegisteredError", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the operator in-app instead of sending them to the App Store", () => {
    render(
      <MemoryRouter>
        <UserNotRegisteredError />
      </MemoryRouter>,
    );

    expect(screen.getByText(/access restricted/i)).toBeTruthy();
    expect(screen.queryByText(/get app/i)).toBeNull();
    expect(screen.getByRole("link", { name: /sign in/i }).getAttribute("href")).toBe(
      "/sign-in",
    );
    expect(screen.getByRole("link", { name: /go home/i }).getAttribute("href")).toBe(
      "/",
    );
  });
});
