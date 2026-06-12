// Close dangling inline-markdown delimiters so a partially-streamed answer renders styled instead of
// showing raw `**` / `` ` `` until the closing token arrives. Pure + unit-tested. Once the full text
// has arrived its delimiters are balanced, so this is a no-op on the final message.

export function completePartialMarkdown(text: string): string {
  let out = text;
  // Unterminated fenced code block → close it first (each fence is ``` ).
  if ((out.match(/```/g)?.length ?? 0) % 2 === 1) out += '\n```';
  // Unterminated bold (**…).
  if ((out.match(/\*\*/g)?.length ?? 0) % 2 === 1) out += '**';
  // Unterminated inline code (`…), counting only backticks left outside of fences.
  const backticks = (out.match(/`/g)?.length ?? 0) - (out.match(/```/g)?.length ?? 0) * 3;
  if (backticks % 2 === 1) out += '`';
  return out;
}
