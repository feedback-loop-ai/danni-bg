import { describe, expect, it } from 'bun:test';
import type { UiContainer } from '@ory/client';
import { defaultValues, flowMessages } from './kratos.ts';

const ui = {
  action: 'https://x/login',
  method: 'POST',
  messages: [{ id: 1, text: 'Welcome', type: 'info' }],
  nodes: [
    {
      type: 'input',
      group: 'default',
      attributes: { name: 'csrf_token', type: 'hidden', value: 'tok', disabled: false },
      messages: [],
      meta: {},
    },
    {
      type: 'input',
      group: 'password',
      attributes: { name: 'identifier', type: 'email', value: 'a@b.c', disabled: false },
      messages: [{ id: 2, text: 'Required', type: 'error' }],
      meta: { label: { id: 1, text: 'Email', type: 'info' } },
    },
    {
      type: 'input',
      group: 'password',
      attributes: { name: 'method', type: 'submit', value: 'password', disabled: false },
      messages: [],
      meta: {},
    },
  ],
} as unknown as UiContainer;

describe('kratos helpers', () => {
  it('flowMessages collects flow-level + per-node messages', () => {
    expect(flowMessages(ui)).toEqual(['Welcome', 'Required']);
    expect(flowMessages(null)).toEqual([]);
  });

  it('defaultValues extracts input values, skipping submit nodes', () => {
    expect(defaultValues(ui)).toEqual({ csrf_token: 'tok', identifier: 'a@b.c' });
    expect(defaultValues(undefined)).toEqual({});
  });
});
