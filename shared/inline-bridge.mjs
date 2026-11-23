// The only writer of legacy inline-handler globals. Composition happens first.
export function registerInlineHandlers(handlers, target = window) {
  for (const [name, handler] of Object.entries(handlers)) {
    if (name in target && target[name] !== handler) throw new Error(`Inline handler collision: ${name}`);
    Object.defineProperty(target, name, { configurable: true, value: handler });
  }
}
