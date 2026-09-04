// Exam Prep — BroadcastChannel test double.
//
// jsdom has no native BroadcastChannel, and Node's own global can behave
// differently under Vitest. This fake models the same-origin fan-out contract
// used by the Locate picker protocol: instances with the SAME name deliver
// each other's messages synchronously to `onmessage`, `close()` removes an
// instance, and no delivery ever happens to the posting instance itself.
//
// Install with `installFakeBroadcastChannel()` (store the previous global),
// publish with `publishToFakeBroadcastChannel(name, data)`, and restore with
// `restoreGlobalBroadcastChannel(previous)`.

type FakeBroadcastChannelInstance = {
  name: string;
  onmessage: ((_event: { data: unknown }) => void) | null;
  close: () => void;
};

const instancesByName = new Map<string, FakeBroadcastChannelInstance[]>();

class FakeBroadcastChannel {
  readonly name: string;
  onmessage: ((_event: { data: unknown }) => void) | null = null;

  constructor(name: string) {
    this.name = name;
    const list = instancesByName.get(name) ?? [];
    list.push(this);
    instancesByName.set(name, list);
  }

  postMessage(data: unknown): void {
    const targets = (instancesByName.get(this.name) ?? []).filter((entry) => entry !== this);
    for (const target of targets) {
      target.onmessage?.({ data });
    }
  }

  close(): void {
    const list = instancesByName.get(this.name) ?? [];
    const next = list.filter((entry) => entry !== this);
    if (next.length > 0) instancesByName.set(this.name, next);
    else instancesByName.delete(this.name);
    this.onmessage = null;
  }
}

/** Installs the fake as the global BroadcastChannel. Returns the previous value. */
export const installFakeBroadcastChannel = (): unknown => {
  instancesByName.clear();
  const previous = (globalThis as Record<string, unknown>).BroadcastChannel;
  (globalThis as Record<string, unknown>).BroadcastChannel = FakeBroadcastChannel;
  return previous;
};

export const restoreGlobalBroadcastChannel = (previous: unknown): void => {
  instancesByName.clear();
  if (previous === undefined) {
    delete (globalThis as Record<string, unknown>).BroadcastChannel;
  } else {
    (globalThis as Record<string, unknown>).BroadcastChannel = previous;
  }
};

/** Synchronously delivers a message to every open instance with `name`. */
export const publishToFakeBroadcastChannel = (name: string, data: unknown): void => {
  for (const instance of instancesByName.get(name) ?? []) {
    instance.onmessage?.({ data });
  }
};

/** Names of currently-open fake channel instances (assertion aid). */
export const openFakeBroadcastChannelNames = (): string[] => [...instancesByName.keys()];
