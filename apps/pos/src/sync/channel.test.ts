import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createMemoryChannelHub,
  createSyncChannel,
  shareStatus,
  type SyncChannel,
} from './channel';
import { createSyncStatusStore } from './status-store';

/** Lets queued messages arrive. */
const delivered = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('createMemoryChannelHub', () => {
  it('delivers a message to every other channel, never to the sender', async () => {
    const open = createMemoryChannelHub();
    const [a, b, c] = [open(), open(), open()];
    const heard: string[] = [];
    a.subscribe(() => heard.push('a'));
    b.subscribe(() => heard.push('b'));
    c.subscribe(() => heard.push('c'));

    a.post('hi');
    await delivered();

    expect(heard).toEqual(['b', 'c']);
  });

  it('delivers nothing to a closed or unsubscribed channel', async () => {
    const open = createMemoryChannelHub();
    const [a, b, c] = [open(), open(), open()];
    const listener = vi.fn();
    b.subscribe(listener)();
    c.subscribe(listener);
    c.close();

    a.post('hi');
    await delivered();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('createSyncChannel', () => {
  const opened: SyncChannel[] = [];
  const track = (channel: SyncChannel) => {
    opened.push(channel);
    return channel;
  };
  afterEach(() => opened.splice(0).forEach((channel) => channel.close()));

  it('carries messages between tabs with BroadcastChannel', async () => {
    const [a, b] = [track(createSyncChannel()), track(createSyncChannel())];
    const heard = vi.fn();
    b.subscribe(heard);

    a.post({ type: 'hello' });

    await vi.waitFor(() => expect(heard).toHaveBeenCalledWith({ type: 'hello' }));
  });

  it('may be closed twice, and ignores messages posted afterwards', () => {
    const channel = createSyncChannel();

    channel.close();
    channel.close();

    expect(() => channel.post('late')).not.toThrow();
  });

  it('still works within one context without BroadcastChannel', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const [a, b] = [track(createSyncChannel()), track(createSyncChannel())];
    const heard = vi.fn();
    b.subscribe(heard);

    a.post('hi');
    await delivered();

    expect(heard).toHaveBeenCalledWith('hi');
    vi.unstubAllGlobals();
  });
});

describe('shareStatus', () => {
  function tabs() {
    const open = createMemoryChannelHub();
    const tab = () => {
      const status = createSyncStatusStore();
      const channel = open();
      return { status, channel, stop: shareStatus(status, channel) };
    };
    return { open, tab };
  }

  it('keeps the connection and syncing state of two tabs in step', async () => {
    const { tab } = tabs();
    const [a, b] = [tab(), tab()];

    a.status.setState({ syncing: true });
    await delivered();
    expect(b.status.getState().syncing).toBe(true);

    a.status.setState({ syncing: false, reachable: false });
    await delivered();
    expect(b.status.getState()).toMatchObject({ syncing: false, reachable: false });

    b.status.setState({ reachable: true });
    await delivered();
    expect(a.status.getState().reachable).toBe(true);
  });

  it('does not echo what it heard back', async () => {
    const { open, tab } = tabs();
    const [a] = [tab(), tab()];
    await delivered();
    const messages = vi.fn();
    open().subscribe(messages);

    a.status.setState({ reachable: false });
    await delivered();

    expect(messages.mock.calls).toEqual([[{ type: 'status', reachable: false }]]);
  });

  it('tells a tab that opens later what is already known', async () => {
    const { tab } = tabs();
    const a = tab();
    a.status.setState({ reachable: false });

    const late = tab();
    await delivered();

    expect(late.status.getState().reachable).toBe(false);
  });

  it('never replaces a known connection state with "not checked yet"', async () => {
    const { tab } = tabs();
    const a = tab();
    a.status.setState({ reachable: true });
    await delivered();

    const late = tab();
    late.status.setState({ syncing: true });
    await delivered();

    expect(a.status.getState().reachable).toBe(true);
    expect(late.status.getState().reachable).toBe(true);
  });

  it('keeps each tab its own storage answer', async () => {
    const { tab } = tabs();
    const [a, b] = [tab(), tab()];

    a.status.setState({ storage: 'denied' });
    await delivered();

    expect(b.status.getState().storage).toBe('unknown');
  });

  it.each([
    null,
    'status',
    { type: 'other' },
    { type: 'status', reachable: 'yes' },
    { type: 'status', syncing: 1 },
    { type: 'status', storage: 'denied' },
  ])('ignores the message %o', async (message) => {
    const { open, tab } = tabs();
    const a = tab();
    const before = a.status.getState();

    open().post(message);
    await delivered();

    expect(a.status.getState()).toEqual(before);
  });

  it('sends and applies nothing once stopped', async () => {
    const { tab } = tabs();
    const [a, b] = [tab(), tab()];

    a.stop();
    a.status.setState({ reachable: false });
    b.status.setState({ syncing: true });
    await delivered();

    expect(b.status.getState().reachable).toBeNull();
    expect(a.status.getState().syncing).toBe(false);
  });
});
