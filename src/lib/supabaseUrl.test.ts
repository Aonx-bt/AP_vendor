import { describe, expect, it } from "vitest";
import { supabaseOrigin } from "./supabaseUrl";

describe("supabaseOrigin", () => {
  it("strips the REST path, trailing slashes and spaces", () => {
    expect(supabaseOrigin("https://abc.supabase.co/rest/v1/")).toBe("https://abc.supabase.co");
    expect(supabaseOrigin(" https://abc.supabase.co/ ")).toBe("https://abc.supabase.co");
    expect(supabaseOrigin("https://abc.supabase.co")).toBe("https://abc.supabase.co");
  });
});
