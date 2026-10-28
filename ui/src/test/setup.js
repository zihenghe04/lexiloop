import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
window.matchMedia = vi.fn((query) => ({ matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
Element.prototype.scrollIntoView = vi.fn();
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
