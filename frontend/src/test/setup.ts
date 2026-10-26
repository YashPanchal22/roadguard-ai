import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

// jsdom does not implement matchMedia (used by the theme provider).
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Leaflet touches these APIs when mounted in a test environment.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

// jsdom lacks object URLs and element scrolling used by the upload previews.
Object.defineProperty(URL, 'createObjectURL', { writable: true, value: vi.fn(() => 'blob:preview') });
Object.defineProperty(URL, 'revokeObjectURL', { writable: true, value: vi.fn() });
Element.prototype.scrollIntoView = vi.fn();
