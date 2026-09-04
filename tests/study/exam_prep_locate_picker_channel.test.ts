/** @vitest-environment jsdom */

// Exam Prep Locate — BroadcastChannel picker transport (real protocol test).
//
// The picker sender must NOT depend on `window.opener` (the sprint opens the
// picker with `noopener,noreferrer`, so the picker has no reverse window
// reference). This suite exercises the actual subscribe/post protocol over a
// same-name BroadcastChannel fake: correct-token delivery, wrong-token
// rejection, close/unsubscribe cleanup, duplicate suppression after close,
// the unsupported-browser fallback, and channel names that never carry
// answer data.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EXAM_PREP_PICK_MESSAGE_TYPE,
  EXAM_PREP_PICKER_CHANNEL_PREFIX,
  createExamPrepLocatePickerToken,
  examPrepLocatePickerChannelName,
  isExamPrepBroadcastChannelSupported,
  postExamPrepLocatePick,
  subscribeExamPrepLocatePicks,
} from '../../src/study/examPrep/examPrepLocatePicker';
import {
  installFakeBroadcastChannel,
  openFakeBroadcastChannelNames,
  publishToFakeBroadcastChannel,
  restoreGlobalBroadcastChannel,
} from './exam_prep_broadcast_channel_support';

const pickMessage = (token: string, documentId: string, sourceKey: string | null) => ({
  type: EXAM_PREP_PICK_MESSAGE_TYPE,
  token,
  documentId,
  sourceKey,
});

describe('Exam Prep Locate picker BroadcastChannel transport', () => {
  let previousBroadcastChannel: unknown;

  beforeEach(() => {
    previousBroadcastChannel = installFakeBroadcastChannel();
  });

  afterEach(() => {
    restoreGlobalBroadcastChannel(previousBroadcastChannel);
  });

  it('builds token-scoped channel names from the opaque random token only', () => {
    const token = createExamPrepLocatePickerToken();
    const name = examPrepLocatePickerChannelName(token);
    expect(name).toBe(`${EXAM_PREP_PICKER_CHANNEL_PREFIX}:${token}`);
    // The token is a random nonce — never a document/provision string — so the
    // channel name can never carry (leak) the expected location. Tokens are
    // not derived from any curriculum data.
    expect(token).toMatch(/^locate-pick-[a-z0-9]+-[a-z0-9]+$/);
    expect(name).not.toContain('|');
  });

  it('delivers a picker selection to the sprint channel for the SAME token with window.opener === null', () => {
    // jsdom windows have no opener by default — the transport must not need one.
    expect(window.opener).toBeFalsy(); // jsdom reports undefined; browsers null — never a real opener
    const token = 'locate-pick-abc123';
    const received: Array<{ documentId: string; sourceKey: string | null }> = [];
    const unsubscribe = subscribeExamPrepLocatePicks(token, (pick) => {
      received.push({ documentId: pick.documentId, sourceKey: pick.sourceKey });
    });

    const sent = postExamPrepLocatePick(token, 'doc-registry-act', 'section:34');
    expect(sent).toBe('sent');
    expect(received).toEqual([{ documentId: 'doc-registry-act', sourceKey: 'section:34' }]);
    expect(window.opener).toBeFalsy(); // jsdom reports undefined; browsers null — never a real opener

    unsubscribe();
    expect(openFakeBroadcastChannelNames()).toEqual([]);
  });

  it('ignores a wrong-token pick on the same channel name', () => {
    const token = 'locate-pick-parent';
    const received: string[] = [];
    subscribeExamPrepLocatePicks(token, (pick) => received.push(pick.token));
    // A forged/duplicate message with a different token on the same channel.
    publishToFakeBroadcastChannel(examPrepLocatePickerChannelName(token), {
      type: EXAM_PREP_PICK_MESSAGE_TYPE,
      token: 'locate-pick-forged',
      documentId: 'doc-other',
      sourceKey: null,
    });
    expect(received).toEqual([]);
  });

  it('ignores malformed payloads and unknown message types', () => {
    const token = 'locate-pick-parent';
    const received: string[] = [];
    subscribeExamPrepLocatePicks(token, (pick) => received.push(pick.token));
    publishToFakeBroadcastChannel(examPrepLocatePickerChannelName(token), { type: 'other' });
    publishToFakeBroadcastChannel(examPrepLocatePickerChannelName(token), null);
    publishToFakeBroadcastChannel(examPrepLocatePickerChannelName(token), 'nope');
    expect(received).toEqual([]);
  });

  it('closes the channel on unsubscribe so later duplicates cannot deliver', () => {
    const token = 'locate-pick-dup';
    const received: Array<{ documentId: string; sourceKey: string | null }> = [];
    const unsubscribe = subscribeExamPrepLocatePicks(token, (pick) => {
      received.push({ documentId: pick.documentId, sourceKey: pick.sourceKey });
    });
    const name = examPrepLocatePickerChannelName(token);

    // First valid delivery is consumed; the sprint then unsubscribes (as it
    // does after one valid pick per item).
    publishToFakeBroadcastChannel(name, pickMessage(token, 'doc-a', 'section:1'));
    expect(received).toHaveLength(1);
    unsubscribe();
    expect(openFakeBroadcastChannelNames()).toEqual([]);

    // A late duplicate delivery on the same name reaches nobody.
    publishToFakeBroadcastChannel(name, pickMessage(token, 'doc-a', 'section:1'));
    expect(received).toHaveLength(1);
  });

  it('does not deliver to a listener on a DIFFERENT token channel', () => {
    const received: string[] = [];
    subscribeExamPrepLocatePicks('locate-pick-parent', (pick) => received.push(pick.token));
    // A picker for a different (stale) token opens its own channel name.
    const sent = postExamPrepLocatePick('locate-pick-stale', 'doc-b', null);
    expect(sent).toBe('sent');
    expect(received).toEqual([]);
  });

  it('reports unsupported and stays usable when BroadcastChannel is unavailable', () => {
    restoreGlobalBroadcastChannel(previousBroadcastChannel);
    // Simulate an environment without BroadcastChannel.
    (globalThis as Record<string, unknown>).BroadcastChannel = undefined;
    expect(isExamPrepBroadcastChannelSupported()).toBe(false);
    expect(postExamPrepLocatePick('t', 'doc-a', null)).toBe('unsupported');
    // subscribe degrades to a no-op cleanup that never throws.
    const unsubscribe = subscribeExamPrepLocatePicks('t', () => {
      throw new Error('must not be called');
    });
    unsubscribe();
    expect(isExamPrepBroadcastChannelSupported()).toBe(false);
  });
});
