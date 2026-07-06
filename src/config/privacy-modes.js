// Moved to src/stack/privacy-modes.js — the main-process stack is the
// enforcement point, so the definitions live there; renderer consumers keep
// this import path via re-export (single source, zero call-site churn).

export * from '../stack/privacy-modes.js';
