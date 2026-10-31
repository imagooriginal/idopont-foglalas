import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LoginForm from "../app/dashboard/login/LoginForm";

vi.mock("../app/dashboard/actions", () => ({
  signInAction: vi.fn(),
}));

describe("LoginForm", () => {
  it("renders required email and password inputs with their validation rules", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText("E-mail-cím")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("E-mail-cím")).toBeRequired();
    expect(screen.getByLabelText("Jelszó")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Jelszó")).toHaveAttribute("minLength", "8");
    expect(screen.getByRole("button", { name: "Bejelentkezés" })).toBeEnabled();
  });
});
