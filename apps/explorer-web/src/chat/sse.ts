// Pure Server-Sent-Events decoder for the chat stream (T050). Feed it raw text chunks; it buffers
// across chunk boundaries and yields complete {event, data} records. Kept pure so the streaming
// protocol is unit-tested without a network.

export interface SSEEvent {
  event: string;
  data: string;
}

export function createSSEDecoder(): { push: (chunk: string) => SSEEvent[] } {
  let buffer = '';
  return {
    push(chunk: string): SSEEvent[] {
      buffer += chunk;
      const events: SSEEvent[] = [];
      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = block.match(/^event:\s*(.*)$/m)?.[1]?.trim();
        const data = block.match(/^data:\s*(.*)$/m)?.[1];
        if (event && data !== undefined) events.push({ event, data });
        sep = buffer.indexOf('\n\n');
      }
      return events;
    },
  };
}

/** Parse a decoded event's JSON data into a typed object (throws on malformed JSON). */
export function parseEventData<T>(ev: SSEEvent): T {
  return JSON.parse(ev.data) as T;
}
