/**
 * Behavioral tests for pure utility functions in validators.ts
 * Uses Vitest for testing
 */

import { describe, it, expect } from "vitest";
import {
  isValidUrl,
  isValidHistoryItem,
  createHistoryItem,
  addToHistory,
  type HistoryItem,
} from "./validators";

describe("isValidUrl", () => {
  it("should return true for valid HTTPS URLs", () => {
    expect(isValidUrl("https://example.com")).toBe(true);
    expect(isValidUrl("https://www.google.com")).toBe(true);
    expect(isValidUrl("https://subdomain.example.org/path")).toBe(true);
  });

  it("should return true for valid HTTP URLs", () => {
    expect(isValidUrl("http://example.com")).toBe(true);
    expect(isValidUrl("http://localhost:3000")).toBe(true);
    expect(isValidUrl("http://127.0.0.1:8080")).toBe(true);
  });

  it("should return false for non-HTTP protocols", () => {
    expect(isValidUrl("ftp://example.com")).toBe(false);
    expect(isValidUrl("file:///path/to/file")).toBe(false);
    expect(isValidUrl("mailto://user@example.com")).toBe(false);
  });

  it("should return false for invalid URLs", () => {
    expect(isValidUrl("not-a-url")).toBe(false);
    expect(isValidUrl("")).toBe(false);
    expect(isValidUrl("htp:/badprotocol")).toBe(false);
  });

  it("should handle edge cases", () => {
    expect(isValidUrl("https://")).toBe(false);
    expect(isValidUrl("https://example.com?query=1")).toBe(true);
    expect(isValidUrl("https://example.com#anchor")).toBe(true);
    expect(isValidUrl("https://user:pass@example.com")).toBe(true);
  });

  it("should return false for non-string inputs", () => {
    expect(isValidUrl(null as unknown as string)).toBe(false);
    expect(isValidUrl(undefined as unknown as string)).toBe(false);
    expect(isValidUrl(123 as unknown as string)).toBe(false);
  });
});

describe("isValidHistoryItem", () => {
  it("should return true for valid history items", () => {
    const validItem: HistoryItem = {
      data: "https://example.com",
      timestamp: "2024-01-01T00:00:00.000Z",
    };
    expect(isValidHistoryItem(validItem)).toBe(true);
  });

  it("should return false for invalid history items", () => {
    expect(isValidHistoryItem(null)).toBe(false);
    expect(isValidHistoryItem(undefined)).toBe(false);
    expect(isValidHistoryItem({})).toBe(false);
    expect(isValidHistoryItem({ data: "test" })).toBe(false);
    expect(isValidHistoryItem({ timestamp: "2024-01-01" })).toBe(false);
    expect(isValidHistoryItem({ data: 123, timestamp: "2024-01-01" })).toBe(
      false
    );
    expect(isValidHistoryItem({ data: "test", timestamp: 123 })).toBe(false);
  });
});

describe("createHistoryItem", () => {
  it("should create a valid history item with current timestamp", () => {
    const item = createHistoryItem("https://example.com");

    expect(item.data).toBe("https://example.com");
    expect(typeof item.timestamp).toBe("string");
    expect(item.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/
    );
  });
});

describe("addToHistory", () => {
  it("should add a new item to the beginning of history", () => {
    const existing: HistoryItem[] = [
      { data: "old1", timestamp: "2024-01-01T00:00:00.000Z" },
      { data: "old2", timestamp: "2024-01-01T00:00:00.001Z" },
    ];
    const newItem: HistoryItem = {
      data: "new",
      timestamp: "2024-01-01T00:00:00.002Z",
    };

    const result = addToHistory(existing, newItem, 5);

    expect(result[0].data).toBe("new");
    expect(result[1].data).toBe("old1");
    expect(result[2].data).toBe("old2");
  });

  it("should trim history to max size", () => {
    const existing: HistoryItem[] = [
      { data: "item1", timestamp: "2024-01-01T00:00:00.001Z" },
      { data: "item2", timestamp: "2024-01-01T00:00:00.002Z" },
      { data: "item3", timestamp: "2024-01-01T00:00:00.003Z" },
    ];
    const newItem: HistoryItem = {
      data: "new",
      timestamp: "2024-01-01T00:00:00.004Z",
    };

    const result = addToHistory(existing, newItem, 3);

    expect(result.length).toBe(3);
    expect(result[0].data).toBe("new");
    expect(result[1].data).toBe("item1");
    expect(result[2].data).toBe("item2");
    expect(result.find((i) => i.data === "item3")).toBeUndefined();
  });

  it("should handle empty history", () => {
    const newItem: HistoryItem = {
      data: "new",
      timestamp: "2024-01-01T00:00:00.000Z",
    };

    const result = addToHistory([], newItem, 5);

    expect(result.length).toBe(1);
    expect(result[0].data).toBe("new");
  });
});
