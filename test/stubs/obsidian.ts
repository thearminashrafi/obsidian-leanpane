/** Minimal stand-in for the "obsidian" module so editor/view code can be unit-tested outside Obsidian. */
export function setIcon(): void {}
export class Notice {
  constructor(public message: string) {}
}
