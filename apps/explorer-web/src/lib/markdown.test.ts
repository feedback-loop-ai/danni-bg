import { describe, expect, it } from 'bun:test';
import { completePartialMarkdown } from './markdown.ts';

describe('completePartialMarkdown', () => {
  it('leaves balanced markdown unchanged', () => {
    expect(completePartialMarkdown('Това е **удебелено** и `код`.')).toBe(
      'Това е **удебелено** и `код`.',
    );
  });

  it('closes a dangling bold delimiter mid-stream', () => {
    expect(completePartialMarkdown('Налични са данни за **Общи')).toBe(
      'Налични са данни за **Общи**',
    );
  });

  it('closes dangling inline code', () => {
    expect(completePartialMarkdown('виж `регист')).toBe('виж `регист`');
  });

  it('does not treat bullet asterisks as bold', () => {
    expect(completePartialMarkdown('* първи\n* втори')).toBe('* първи\n* втори');
  });

  it('closes an open fenced code block without miscounting inline backticks', () => {
    expect(completePartialMarkdown('```\ncode here')).toBe('```\ncode here\n```');
  });

  it('balances an odd number of bold runs', () => {
    expect(completePartialMarkdown('**a** и **b')).toBe('**a** и **b**');
  });
});
