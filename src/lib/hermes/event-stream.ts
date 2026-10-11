/** Reads an SSE body as it arrives. A buffered body fails the delayed-stream test. */
export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) onFrame(frame);
  }
  if (buffer.trim()) onFrame(buffer);
}
