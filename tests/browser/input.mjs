// Playwright routes mouse input directly to an out-of-process iframe. Moving
// back to the workbench does not notify the old CDP target, unlike a physical
// pointer crossing its edge. Send that browser input to the old target first
// so the real pointerleave/mouseleave events and :hover state remain accurate.
export async function webviewPointerExit(page, frame) {
  let session;
  for (let target = frame; target && !session; target = target.parentFrame())
    session = await page.context().newCDPSession(target).catch(() => undefined);
  if (!session) throw new Error('Cannot access the reader mouse input target');
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: -1, y: -1 });
  await session.detach();
}
